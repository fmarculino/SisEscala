import { NextResponse } from 'next/server'
import { urlPublicaDeRequest } from '@/utils/urlPublica'
import { readFile } from 'fs/promises'
import path from 'path'
import { createClient } from '@/utils/supabase/server'
import { criarZipSemCompressao } from '@/utils/zip'

/**
 * Devolve um .zip com o app de bandeja (tools/coletor-rep/dist/coletor-rep-tray.exe) + um
 * config.yaml já preenchido com o id/token do terminal ou dispositivo escolhido — quem instala
 * numa unidade não copia token nenhum à mão.
 *
 * O token chega no corpo do POST porque o admin acabou de gerá-lo pela tela (mesmo fluxo de
 * "Gerar token" que já existia) — esta rota não gera um token novo, só empacota o que já foi
 * gerado. Gerar de novo aqui invalidaria silenciosamente qualquer terminal já instalado toda
 * vez que alguém clicasse em "Baixar aplicativo" de novo.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Apenas administradores podem baixar o aplicativo.' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const tipo: string = body?.tipo
  const id: string = body?.id
  const token: string = body?.token
  // tipo 'unidade' empacota VÁRIOS relógios num config.yaml só — o computador da unidade que
  // atende os 4 equipamentos. A lista de {id, token} vem do cliente porque os tokens acabaram de
  // ser gerados pela action (gerarTokensUnidadeRep), mesmo fluxo do caso de um relógio: esta rota
  // nunca gera token, senão cada clique em "Baixar" invalidaria em silêncio a instalação de campo.
  const dispositivosPedidos: { id: string; token: string }[] = Array.isArray(body?.dispositivos) ? body.dispositivos : []
  if (tipo === 'unidade') {
    if (dispositivosPedidos.length === 0 || dispositivosPedidos.some((d) => !d?.id || !d?.token)) {
      return NextResponse.json({ error: 'Lista de dispositivos (id e token) é obrigatória.' }, { status: 400 })
    }
  } else if ((tipo !== 'terminal' && tipo !== 'dispositivo') || !id || !token) {
    return NextResponse.json({ error: 'tipo, id e token são obrigatórios.' }, { status: 400 })
  }

  const origem = resolverUrlPublica(request)
  if (!origem) {
    console.error(
      'Nem NEXT_PUBLIC_SITE_URL nem X-Forwarded-Host disponíveis — não é seguro adivinhar a URL publica.'
    )
    return NextResponse.json(
      { error: 'Configuração do servidor incompleta (URL pública desconhecida). Avise o administrador do sistema.' },
      { status: 503 }
    )
  }

  let configYaml: string
  if (tipo === 'terminal') {
    configYaml = montarConfigTerminal(origem, id, token)
  } else if (tipo === 'unidade') {
    const { data: encontrados, error: erroLista } = await supabase
      .from('dispositivos_rep')
      .select('id, nome, endereco_ip, usuario_rep, senha_rep, porta, usa_https')
      .in('id', dispositivosPedidos.map((d) => d.id))
    if (erroLista) {
      return NextResponse.json({ error: erroLista.message }, { status: 500 })
    }
    const porId = new Map((encontrados || []).map((d: any) => [d.id, d]))
    // Faltando UM relógio, o pacote inteiro é recusado. Um config.yaml com três dos quatro
    // equipamentos instala e roda sem erro nenhum — e o quarto simplesmente não é coletado, que
    // é o modo de falha silencioso que este módulo inteiro existe para não ter.
    const faltando = dispositivosPedidos.filter((d) => !porId.has(d.id))
    if (faltando.length > 0) {
      return NextResponse.json(
        { error: `Dispositivo REP não encontrado: ${faltando.map((d) => d.id).join(', ')}` },
        { status: 404 }
      )
    }
    configYaml = montarConfigUnidade(
      origem,
      dispositivosPedidos.map((pedido) => ({ ...porId.get(pedido.id), token: pedido.token }))
    )
  } else {
    // Le endereco/usuario/senha/porta direto do banco (nao do corpo da requisicao) - sao os
    // mesmos campos que o admin acabou de preencher em "Editar dispositivo REP", e assim o zip
    // sai pronto sem editar config.yaml a mao (a lacuna que restava depois da v1.48.2).
    const { data: dispositivo, error: dispErr } = await supabase
      .from('dispositivos_rep')
      .select('endereco_ip, usuario_rep, senha_rep, porta, usa_https')
      .eq('id', id)
      .single()
    if (dispErr || !dispositivo) {
      return NextResponse.json({ error: 'Dispositivo REP não encontrado.' }, { status: 404 })
    }
    configYaml = montarConfigDispositivo(origem, id, token, dispositivo)
  }

  let binario: Buffer
  try {
    const caminhoBinario = path.join(process.cwd(), 'tools', 'coletor-rep', 'dist', 'coletor-rep-tray.exe')
    binario = await readFile(caminhoBinario)
  } catch (err: any) {
    console.error('Binário do coletor-rep não encontrado:', err.message)
    return NextResponse.json(
      { error: 'Aplicativo indisponível no servidor no momento. Avise o administrador do sistema.' },
      { status: 503 }
    )
  }

  const zip = criarZipSemCompressao([
    { nome: 'coletor-rep-tray.exe', conteudo: binario },
    { nome: 'config.yaml', conteudo: Buffer.from(configYaml, 'utf8') },
  ])

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="coletor-rep-${tipo}.zip"`,
      'Content-Length': String(zip.length),
    },
  })
}

/**
 * `new URL(request.url).origin` NÃO É CONFIÁVEL atrás do proxy do Coolify: já produziu
 * `http://localhost:3000` num download real (o bind interno do servidor standalone, não o
 * domínio público) — resultado inútil embutido no config.yaml de alguém tentando instalar.
 * `NEXT_PUBLIC_SITE_URL` é a mesma variável que o link de sobreaviso por WhatsApp já usa
 * (`src/app/actions/sobreaviso.ts`) por este exato motivo. `X-Forwarded-Host` é o fallback
 * padrão de quem está atrás de um reverse proxy (Traefik envia esse header por padrão).
 */
function resolverUrlPublica(request: Request): string | null {
  // Delegado a src/utils/urlPublica.ts em 30/08/2026: o link magico de sobreaviso precisou da
  // MESMA resposta, e o comentario acima ja dizia que as duas eram a mesma necessidade. Duas
  // copias divergiriam — foi por isso que a extracao aconteceu.
  return urlPublicaDeRequest(request)
}

function montarConfigTerminal(origem: string, id: string, token: string): string {
  return `sisescala:
  url: ${origem}

terminal_local:
  id: "${id}"
  token: "${token}"
`
}

/**
 * config.yaml de um computador que atende VÁRIOS relógios da mesma unidade (há unidades com 4).
 *
 * Usa a chave plural `dispositivos_rep`, lida pelo coletor a partir da v0.9.0. Cada relógio
 * mantém id e token próprios — é o token que identifica de qual equipamento veio cada linha do
 * AFD, e o coletor recusa o arquivo se dois ids se repetirem.
 */
function montarConfigUnidade(
  origem: string,
  dispositivos: {
    id: string
    nome: string | null
    token: string
    endereco_ip: string | null
    usuario_rep: string | null
    senha_rep: string | null
    porta: number | null
    usa_https: boolean | null
  }[]
): string {
  const blocos = dispositivos
    .map(
      (d) => `  - nome: "${(d.nome || '').replace(/"/g, "'")}"
    id: "${d.id}"
    token: "${d.token}"
    endereco: "${d.endereco_ip || 'PREENCHA_O_IP_DO_RELOGIO'}"
    porta: ${d.porta ?? 443}
    usa_https: ${d.usa_https ?? true}
    usuario_rep: "${d.usuario_rep || 'admin'}"
    senha_rep: "${d.senha_rep || 'PREENCHA_A_SENHA_DE_ADMIN_DO_RELOGIO'}"
    cert_fingerprint: ""`
    )
    .join('\n')

  return `sisescala:
  url: ${origem}

# ${dispositivos.length} relogios coletados por esta maquina. Cada um tem id e token proprios;
# o coletor sincroniza todos no mesmo ciclo e mantem fila e cursor de NSR separados por
# equipamento. Relogio fora do ar nao impede os outros de sincronizar.
dispositivos_rep:
${blocos}
  # Descomente e aumente SO se o coletor-rep.log acusar "context deadline exceeded ... while
  # reading body" na primeira coleta (relogio com historico grande demora para montar o AFD).
  # A chave e por relogio: timeout_afd_segundos: 900
`
}

function montarConfigDispositivo(
  origem: string,
  id: string,
  token: string,
  dispositivo: { endereco_ip: string | null; usuario_rep: string | null; senha_rep: string | null; porta: number | null; usa_https: boolean | null }
): string {
  return `sisescala:
  url: ${origem}

dispositivo_rep:
  id: "${id}"
  token: "${token}"
  endereco: "${dispositivo.endereco_ip || 'PREENCHA_O_IP_DO_RELOGIO'}"
  porta: ${dispositivo.porta ?? 443}
  usa_https: ${dispositivo.usa_https ?? true}
  usuario_rep: "${dispositivo.usuario_rep || 'admin'}"
  senha_rep: "${dispositivo.senha_rep || 'PREENCHA_A_SENHA_DE_ADMIN_DO_RELOGIO'}"
  cert_fingerprint: ""
  # Descomente e aumente SO se o coletor-rep.log acusar "context deadline exceeded ... while
  # reading body" na primeira coleta (relogio com historico grande demora para montar o AFD).
  # Ausente usa 600s. Vale so para get_afd.fcgi; as outras chamadas seguem em 30s.
  # timeout_afd_segundos: 900
`
}
