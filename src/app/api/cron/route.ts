import { NextResponse } from 'next/server'
import { autoCloseExpiredScalesAndTimesheets, autoGenerateMissingTimesheets } from '@/utils/autoClose'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const secret = searchParams.get('secret')
    const authHeader = request.headers.get('authorization')
    
    // Fallback secret for safety during setup
    const expectedSecret = process.env.CRON_SECRET || 'sis-escala-cron-token-2026'
    const providedSecret = secret || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null)
    
    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
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
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      autoClose: closeRes,
      autoGenerateMissingDrafts: {
        mes: prevMes,
        ano: prevAno,
        result: genRes
      }
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
