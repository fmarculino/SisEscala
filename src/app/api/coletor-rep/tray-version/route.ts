import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'

/**
 * Versão + sha256 de `coletor-rep-tray.exe` disponíveis no servidor agora — é contra isto que o
 * próprio app de bandeja compara a versão que já tem instalada (`ciclo.Versao`,
 * `tools/coletor-rep/ciclo/ciclo.go`) pra saber se existe atualização.
 *
 * Público, sem sessão — mesmo espírito de `/api/version` (usado pelo terminal web pra se
 * auto-atualizar). O `.exe` puro não carrega segredo nenhum (token vive só no `config.yaml`,
 * gerado à parte em `/api/coletor-rep/download`), e o app roda sem sessão de navegador
 * nenhuma — exigir login aqui deixaria toda máquina de campo sem conseguir checar sozinha.
 *
 * `VERSION` é texto commitado manualmente junto do `.exe` a cada recompilação (mesmo processo já
 * documentado no CLAUDE.md pro binário em si). O sha256 é calculado em runtime sobre o próprio
 * `.exe` servido — não precisa de mais um arquivo pra manter em sincronia manualmente.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const dist = path.join(process.cwd(), 'tools', 'coletor-rep', 'dist')

  let versao: string
  try {
    versao = (await readFile(path.join(dist, 'VERSION'), 'utf8')).trim()
  } catch (err: any) {
    console.error('VERSION do coletor-rep-tray não encontrada:', err.message)
    return NextResponse.json({ error: 'Versão indisponível no servidor no momento.' }, { status: 503 })
  }

  let sha256: string
  try {
    const binario = await readFile(path.join(dist, 'coletor-rep-tray.exe'))
    sha256 = createHash('sha256').update(binario).digest('hex')
  } catch (err: any) {
    console.error('Binário coletor-rep-tray.exe não encontrado:', err.message)
    return NextResponse.json({ error: 'Binário indisponível no servidor no momento.' }, { status: 503 })
  }

  return NextResponse.json({ versao, sha256 }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
