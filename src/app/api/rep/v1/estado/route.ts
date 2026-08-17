import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * GET — o coletor pergunta de qual NSR deve pedir o AFD (`initial_nsr` de `get_afd.fcgi`).
 *
 * Existe porque `ciclo.Sync` pedia o AFD sempre a partir do NSR 1, ou seja o arquivo inteiro do
 * relógio a cada 5 minutos. Num equipamento reaproveitado isso passa de "desperdício" a "não
 * funciona": em 17/08/2026 o REP iDClass - SMS (10.110.0.20) tinha ZERO sincronizações desde a
 * instalação, porque montar as ~40 mil linhas leva mais que o timeout do coletor.
 *
 * O cursor é `fn_cursor_afd_dispositivo` — fim do trecho CONTÍGUO de NSR mais 1, deliberadamente
 * NÃO `dispositivos_rep.ultimo_nsr + 1`. O porquê está na migration `20260817150000`, e o resumo
 * é: lacuna no meio tem que puxar o cursor de volta, senão um NSR que não chegou fica para trás
 * para sempre — batida descartada em silêncio.
 *
 * Em erro esta rota responde 5xx de propósito, sem "chutar" um cursor: o coletor trata falha
 * caindo para o último cursor conhecido (ou para o NSR 1), que erra sempre para o lado de
 * baixar demais. Devolver um número errado para cima seria o único jeito de perder marcação.
 */
export async function GET(request: Request) {
  const auth = await autenticarDispositivoRep(request, '')
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_cursor_afd_dispositivo', {
    p_dispositivo_id: auth.dispositivoId,
  })
  if (error) {
    console.error('Falha ao calcular cursor de AFD:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const proximoNsr = Number(data)
  if (!Number.isInteger(proximoNsr) || proximoNsr < 1) {
    console.error('fn_cursor_afd_dispositivo devolveu cursor inválido:', data)
    return NextResponse.json({ error: 'Cursor de AFD inválido.' }, { status: 500 })
  }

  // ultimo_nsr é só para o log do coletor em campo (o "pedindo do NSR X, último ingerido Y" que
  // permite ver de longe se a coleta está andando). Não participa da decisão do cursor.
  const { data: dispositivo } = await supabase
    .from('dispositivos_rep')
    .select('ultimo_nsr')
    .eq('id', auth.dispositivoId)
    .maybeSingle()

  return NextResponse.json({
    proximo_nsr: proximoNsr,
    ultimo_nsr: dispositivo?.ultimo_nsr ?? null,
  })
}
