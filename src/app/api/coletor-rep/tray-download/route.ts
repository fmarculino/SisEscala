import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

/**
 * Baixa `coletor-rep-tray.exe` puro — sem zip, sem config.yaml. É o que o próprio app de bandeja
 * baixa sozinho quando `/api/coletor-rep/tray-version` acusa versão mais nova (ver
 * `ciclo.AplicarAtualizacao`, `tools/coletor-rep/ciclo/ciclo.go`), pra trocar o próprio `.exe`
 * sem precisar gerar um zip novo (que traria um `config.yaml` novo e obrigaria reconfigurar).
 *
 * Público, sem sessão — mesmo raciocínio de `tray-version/route.ts`: o app roda sem navegador
 * numa máquina de campo, e o binário em si não carrega token nem segredo nenhum.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  let binario: Buffer
  try {
    const caminhoBinario = path.join(process.cwd(), 'tools', 'coletor-rep', 'dist', 'coletor-rep-tray.exe')
    binario = await readFile(caminhoBinario)
  } catch (err: any) {
    console.error('Binário coletor-rep-tray.exe não encontrado:', err.message)
    return NextResponse.json({ error: 'Binário indisponível no servidor no momento.' }, { status: 503 })
  }

  return new NextResponse(new Uint8Array(binario), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="coletor-rep-tray.exe"',
      'Content-Length': String(binario.length),
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
