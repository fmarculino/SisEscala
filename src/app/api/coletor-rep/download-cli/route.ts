import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { createClient } from '@/utils/supabase/server'

/**
 * Baixa `coletor-rep-cli.exe` puro — sem zip, sem config.yaml embutido. Diferente do
 * `/api/coletor-rep/download` (que empacota o app de bandeja já configurado para um
 * terminal/dispositivo específico), a CLI é ferramenta de diagnóstico: quem a baixa já tem o
 * `coletor-rep-tray.exe` instalado nessa mesma máquina, com `config.yaml` ao lado — a CLI lê
 * esse mesmo arquivo (mesmo formato, mesmo pacote `config/`). Ela nunca foi distribuída junto
 * do app de bandeja porque não é para rodar continuamente (ver `cmd/cli/main.go`), mas
 * `coletor-rep cadastros-testar` (Fase 7) precisa dela numa máquina real para validar
 * `create_objects.fcgi`/`load_objects.fcgi` contra hardware antes de confiar no botão da
 * bandeja — daí esta rota existir.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Apenas administradores podem baixar a CLI de diagnóstico.' }, { status: 403 })
  }

  let binario: Buffer
  try {
    const caminhoBinario = path.join(process.cwd(), 'tools', 'coletor-rep', 'dist', 'coletor-rep-cli.exe')
    binario = await readFile(caminhoBinario)
  } catch (err: any) {
    console.error('Binário coletor-rep-cli.exe não encontrado:', err.message)
    return NextResponse.json(
      { error: 'CLI indisponível no servidor no momento. Avise o administrador do sistema.' },
      { status: 503 }
    )
  }

  return new NextResponse(new Uint8Array(binario), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="coletor-rep-cli.exe"',
      'Content-Length': String(binario.length),
    },
  })
}
