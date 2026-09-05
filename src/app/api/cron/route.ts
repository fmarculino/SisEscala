import { NextResponse } from 'next/server'
import { conferirSegredoCron } from '@/utils/segredoCron'
import { autoCloseExpiredScalesAndTimesheets, autoGenerateMissingTimesheets } from '@/utils/autoClose'
import { enfileirarCadastrosDoParque } from '@/utils/rep/enfileirarCadastrosParque'

export async function GET(request: Request) {
  try {
    // Fonte unica: src/utils/segredoCron.ts. O segredo deixou de ser aceito por QUERY STRING em
    // 30/08/2026 (achado 15) - `?secret=` vaza para log de proxy, historico de terminal e
    // Referer -, e a comparacao passou a ser em tempo constante.
    const auth = conferirSegredoCron(request)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro }, { status: auth.status })
    }

    // 1. Fechamento automático de escalas vencidas (baseado no limite de inativação das configurações)
    const closeRes = await autoCloseExpiredScalesAndTimesheets()
    
    // 2. Geração automática de rascunhos para a competência anterior (virada do mês)
    const now = new Date()
    let prevMes = now.getMonth() // 0-indexed (se hoje é janeiro [0], prevMes é 0 [dezembro])
    let prevAno = now.getFullYear()
    if (prevMes === 0) {
      prevMes = 12
      prevAno -= 1
    }
    
    const genRes = await autoGenerateMissingTimesheets(prevMes, prevAno)

    // 3. Envia ao ponto quem já tem unidade/setor definidos e ainda não está no relógio.
    //    Até 05/09/2026 isso dependia de alguém clicar "Sincronizar cadastros" na tela de
    //    Marcações — não havia trigger nem cron, então servidor novo nunca chegava ao
    //    equipamento sozinho. Só popula a fila; quem grava no relógio é o coletor da unidade.
    const repRes = await enfileirarCadastrosDoParque()

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      autoClose: closeRes,
      autoGenerateMissingDrafts: {
        mes: prevMes,
        ano: prevAno,
        result: genRes
      },
      enfileirarCadastrosRep: repRes
    })
  } catch (error: any) {
    console.error('Erro na rota de Cron:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Support POST request as well
export async function POST(request: Request) {
  return GET(request)
}
