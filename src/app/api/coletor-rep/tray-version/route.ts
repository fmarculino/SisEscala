import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import path from 'path'
import { createAdminClient } from '@/utils/supabase/server'

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

  // Política de auto-atualização. Vive em `configuracoes_globais` e NÃO no código de propósito:
  // o parque está espalhado por unidades sem acesso físico prático, então o único jeito de parar
  // uma versão ruim é um interruptor do lado do SERVIDOR. Trocar a chave interrompe a propagação
  // no próximo ciclo de cada máquina, sem deploy e sem tocar em nenhuma delas.
  //
  // Medido em 26/08/2026, o que motivou ligar isso: 11 dos 15 relógios estavam desatualizados
  // (9 em v0.8.0, 1 em v0.7.0, 1 em v0.10.0) e TODOS com contato recente — ou seja, o gargalo
  // nunca foi rede nem máquina desligada, era o clique manual que ninguém dava.
  //
  // Ausente = ligado (é o padrão do produto). Erro de leitura = DESLIGADO: sem conseguir ler a
  // política, o certo é não mandar o parque inteiro trocar de binário.
  let autoUpdate = true
  let atrasoMaxMinutos = 240
  try {
    const admin = await createAdminClient()
    const { data } = await admin
      .from('configuracoes_globais')
      .select('chave, valor')
      .in('chave', ['coletor_auto_update', 'coletor_auto_update_atraso_max_minutos'])

    for (const row of data || []) {
      const bruto = typeof row.valor === 'string' ? row.valor : String(row.valor ?? '')
      if (row.chave === 'coletor_auto_update') {
        autoUpdate = bruto !== 'false' && bruto !== '"false"' && bruto !== '0'
      }
      if (row.chave === 'coletor_auto_update_atraso_max_minutos') {
        const n = parseInt(bruto.replace(/"/g, ''), 10)
        if (Number.isFinite(n) && n >= 0) atrasoMaxMinutos = n
      }
    }
  } catch (err: any) {
    console.error('Falha ao ler politica de auto-update do coletor, assumindo desligado:', err.message)
    autoUpdate = false
  }

  return NextResponse.json(
    { versao, sha256, auto_update: autoUpdate, atraso_max_minutos: atrasoMaxMinutos },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
