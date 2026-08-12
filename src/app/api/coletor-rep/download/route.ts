import { NextResponse } from 'next/server'
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
  const enderecoIp: string | undefined = body?.endereco_ip
  if ((tipo !== 'terminal' && tipo !== 'dispositivo') || !id || !token) {
    return NextResponse.json({ error: 'tipo, id e token são obrigatórios.' }, { status: 400 })
  }

  const origem = new URL(request.url).origin
  const configYaml = tipo === 'terminal'
    ? montarConfigTerminal(origem, id, token)
    : montarConfigDispositivo(origem, id, token, enderecoIp)

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

function montarConfigTerminal(origem: string, id: string, token: string): string {
  return `sisescala:
  url: ${origem}

terminal_local:
  id: "${id}"
  token: "${token}"
`
}

function montarConfigDispositivo(origem: string, id: string, token: string, enderecoIp?: string): string {
  return `sisescala:
  url: ${origem}

dispositivo_rep:
  id: "${id}"
  token: "${token}"
  endereco: "${enderecoIp || 'PREENCHA_O_IP_DO_RELOGIO'}"
  porta: 443
  usa_https: true
  usuario_rep: admin
  senha_rep: "PREENCHA_A_SENHA_DE_ADMIN_DO_RELOGIO"
  cert_fingerprint: ""
`
}
