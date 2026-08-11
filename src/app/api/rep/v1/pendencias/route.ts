import { NextResponse } from 'next/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Fila de pendências de cadastro (push SisEscala -> REP) é Fase 7 do plano — deliberadamente
 * fora do escopo desta rodada. A rota já existe para o coletor não precisar de outra versão
 * de protocolo quando a fila for implementada; por ora devolve sempre vazio.
 */
export async function GET(request: Request) {
  const auth = await autenticarDispositivoRep(request, '')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json([])
}
