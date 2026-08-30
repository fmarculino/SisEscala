# Faz validatePin delegar o bloqueio de tentativas ao banco (fn_validar_pin_portal).
# Substituicao de bloco unico, com contagem — aborta se o trecho antigo nao casar exatamente.
import io, sys

P = 'src/app/consultar-escala/actions.ts'

ANTIGO = """export async function validatePin(matricula: string, pin: string) {
  const supabase = await createAdminClient()

  const { data: servidor, error } = await supabase
    .from('servidores')
    .select('id, nome, pin_acesso, pin_failed_attempts, last_pin_attempt')
    .eq('matricula', matricula)
    .eq('status', 'Ativo')
    .single()

  if (error || !servidor) {
    return { error: 'Servidor não encontrado.' }
  }

  const servidorId = servidor.id

  // Verificar bloqueio por tentativas (15 minutos de cooldown após 5 erros)
  const MAX_ATTEMPTS = 5
  const COOLDOWN_MINUTES = 15

  if (servidor.last_pin_attempt) {
    const lastAttempt = new Date(servidor.last_pin_attempt)
    const now = new Date()
    const diffMinutes = (now.getTime() - lastAttempt.getTime()) / (1000 * 60)

    if (diffMinutes >= COOLDOWN_MINUTES) {
      // Cooldown expirado: resetar contador para dar nova chance
      await supabase
        .from('servidores')
        .update({ pin_failed_attempts: 0 })
        .eq('id', servidorId)
      servidor.pin_failed_attempts = 0
    } else if (servidor.pin_failed_attempts >= MAX_ATTEMPTS) {
      // Bloqueado
      return {
        error: `Muitas tentativas incorretas. Sua conta está bloqueada por mais ${Math.ceil(COOLDOWN_MINUTES - diffMinutes)} minutos.`
      }
    }
  }

  if (!servidor.pin_acesso) {
    return { error: 'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.' }
  }

  // Validar o PIN de forma segura usando bcrypt no PostgreSQL
  const { data: isPinValid, error: rpcError } = await supabase.rpc('verify_pin', {
    p_servidor_id: servidorId,
    p_pin: pin
  })

  if (rpcError || !isPinValid) {
    const newAttempts = (servidor.pin_failed_attempts || 0) + 1

    // Incrementar tentativas falhas
    await supabase
      .from('servidores')
      .update({
        pin_failed_attempts: newAttempts,
        last_pin_attempt: new Date().toISOString()
      })
      .eq('id', servidorId)

    const attemptsLeft = MAX_ATTEMPTS - newAttempts
    if (attemptsLeft > 0) {
      return { error: `PIN incorreto. Você tem mais ${attemptsLeft} tentativa(s) antes do bloqueio.` }
    } else {
      return { error: `Muitas tentativas incorretas. Sua conta está bloqueada por 15 minutos.` }
    }
  }

  // Sucesso: Resetar tentativas falhas
  await supabase
    .from('servidores')
    .update({
      pin_failed_attempts: 0,
      last_pin_attempt: new Date().toISOString()
    })
    .eq('id', servidorId)

  // Sessao ASSINADA (HMAC) — nunca mais o UUID cru. Ver src/utils/portalSession.ts.
  const cookieStore = await cookies()
  const sessao = criarSessaoPortal(servidor.id)
  cookieStore.set(PORTAL_COOKIE, sessao.value, opcoesCookiePortal(sessao.maxAge))

  // Apaga o cookie antigo, se o navegador ainda tiver um. Enquanto ele existir em circulacao,
  // existe um cookie FORJAVEL no ambiente — e nada mais o le', entao mante-lo so' cria confusao.
  cookieStore.delete(PORTAL_COOKIE_LEGADO)

  return { success: true, nome: servidor.nome }
}"""

NOVO = """/**
 * Login do Portal: valida (matricula, PIN) e abre a sessao assinada.
 *
 * ⚠️ A decisao inteira — resolver a matricula, aplicar o bloqueio de 5 tentativas / 15 minutos e
 * conferir o PIN — mora em `fn_validar_pin_portal`, no BANCO, numa transacao so.
 *
 * Antes de 30/08/2026 essa logica vivia aqui, e tinha dois furos:
 *   1. era CONTORNAVEL: `verify_pin` estava aberta ao papel `anon` (medido em producao: HTTP
 *      200 com a chave do bundle), entao qualquer um chamava a verificacao direto pelo
 *      PostgREST sem passar por este contador. Com PIN de 4 digitos sao 9.000 tentativas.
 *   2. tinha CORRIDA: ler `pin_failed_attempts`, decidir e so entao gravar deixa N requisicoes
 *      simultaneas lerem 0 e passarem juntas — e forca bruta e, por definicao, concorrente.
 *
 * As mensagens em portugues continuam AQUI de proposito: a funcao devolve codigo e numeros, para
 * nao existirem dois lugares escrevendo o texto que o servidor le.
 */
export async function validatePin(matricula: string, pin: string) {
  const supabase = await createAdminClient()

  const { data, error } = await supabase.rpc('fn_validar_pin_portal', {
    p_matricula: matricula,
    p_pin: pin,
  })

  if (error) {
    console.error('Erro ao validar PIN do portal:', error.message)
    return { error: 'Não foi possível validar o PIN agora. Tente novamente.' }
  }

  const r = data as {
    resultado: 'ok' | 'bloqueado' | 'sem_pin' | 'nao_encontrado' | 'pin_invalido'
    servidor_id?: string
    nome?: string
    minutos_restantes?: number
    tentativas_restantes?: number
  }

  switch (r?.resultado) {
    case 'nao_encontrado':
      return { error: 'Servidor não encontrado.' }

    case 'bloqueado':
      return {
        error: `Muitas tentativas incorretas. Sua conta está bloqueada por mais ${r.minutos_restantes} minutos.`
      }

    case 'sem_pin':
      return { error: 'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.' }

    case 'pin_invalido': {
      const restantes = r.tentativas_restantes ?? 0
      if (restantes > 0) {
        return { error: `PIN incorreto. Você tem mais ${restantes} tentativa(s) antes do bloqueio.` }
      }
      return { error: `Muitas tentativas incorretas. Sua conta está bloqueada por 15 minutos.` }
    }

    case 'ok':
      break

    default:
      return { error: 'Não foi possível validar o PIN agora. Tente novamente.' }
  }

  if (!r.servidor_id) {
    return { error: 'Não foi possível validar o PIN agora. Tente novamente.' }
  }

  // Sessao ASSINADA (HMAC) — nunca mais o UUID cru. Ver src/utils/portalSession.ts.
  const cookieStore = await cookies()
  const sessao = criarSessaoPortal(r.servidor_id)
  cookieStore.set(PORTAL_COOKIE, sessao.value, opcoesCookiePortal(sessao.maxAge))

  // Apaga o cookie antigo, se o navegador ainda tiver um. Enquanto ele existir em circulacao,
  // existe um cookie FORJAVEL no ambiente — e nada mais o le', entao mante-lo so cria confusao.
  cookieStore.delete(PORTAL_COOKIE_LEGADO)

  return { success: true, nome: r.nome }
}"""

s = io.open(P, encoding='utf-8', newline='').read()
eol = '\r\n' if '\r\n' in s else '\n'
antigo = ANTIGO.replace('\n', eol)
novo = NOVO.replace('\n', eol)

n = s.count(antigo)
if n != 1:
    print('ABORTADO: %d ocorrencias do bloco antigo de validatePin (eol=%r)' % (n, eol))
    sys.exit(1)

s = s.replace(antigo, novo)

# Conferencias estruturais
if "supabase.rpc('verify_pin'" in s:
    print('ABORTADO: ainda ha chamada direta a verify_pin no arquivo'); sys.exit(1)
if "fn_validar_pin_portal" not in s:
    print('ABORTADO: a chamada a fn_validar_pin_portal nao entrou'); sys.exit(1)

# As cinco mensagens que o servidor le tem que sobreviver PALAVRA POR PALAVRA
MENSAGENS = [
    'Servidor não encontrado.',
    'Você ainda não possui um PIN cadastrado. Solicite ao seu coordenador.',
    'Muitas tentativas incorretas. Sua conta está bloqueada por mais ',
    'PIN incorreto. Você tem mais ',
    'Muitas tentativas incorretas. Sua conta está bloqueada por 15 minutos.',
]
for m in MENSAGENS:
    if m not in s:
        print('ABORTADO: a mensagem %r sumiu do fluxo de login' % m); sys.exit(1)

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK: validatePin passou a delegar o bloqueio ao banco (fn_validar_pin_portal)')
print('    as 5 mensagens de usuario foram preservadas literalmente')
