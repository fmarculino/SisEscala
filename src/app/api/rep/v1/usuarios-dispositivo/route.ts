import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/server'
import { autenticarDispositivoRep } from '@/utils/repDeviceAuth'

/**
 * Higiene de cadastros do dispositivo REP (Fase 7b, 12/08/2026) — o coletor reporta aqui o
 * snapshot COMPLETO de quem está cadastrado no relógio agora (`load_users.fcgi`), não só quem
 * o SisEscala já conhece. Um relógio usado antes por outro sistema chega com cadastros de gente
 * que pode não fazer mais parte do quadro — isto alimenta a tela de higiene em `/marcacoes` para
 * identificar quem não corresponde a nenhum servidor ativo.
 *
 * Só o coletor chama isto (leitura no equipamento, nunca grava nada nele) — a ação de remover
 * fica em `/api/rep/v1/remocoes`, sempre depois de alguém revisar na tela.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const auth = await autenticarDispositivoRep(request, rawBody)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })
  }

  const usuarios = Array.isArray(body?.usuarios) ? body.usuarios : []

  // 🚨 `=== true` literal, nunca truthy, e nunca um default otimista (06/09/2026).
  //
  // Lista vazia tem DOIS significados que o payload não distingue: o relógio foi lido e está
  // realmente vazio (equipamento substituído — foi o caso do CCE), ou a leitura falhou e o
  // `Array.isArray(...) ? ... : []` acima caiu para vazio sozinho. Só o coletor sabe qual dos
  // dois é, e desde a v0.16.0 ele diz.
  //
  // Com `true` e lista vazia, a RPC encerra TODOS os vínculos vigentes do dispositivo. Por isso
  // qualquer coisa que não seja o booleano `true` — campo ausente (coletor anterior à v0.16.0),
  // string "true", 1, null, corpo malformado — vira `false` e preserva o comportamento de hoje.
  const leituraOk = body?.leitura_ok === true

  const supabase = await createAdminClient()
  let { data, error } = await supabase.rpc('fn_registrar_snapshot_usuarios_dispositivo', {
    p_dispositivo_id: auth.dispositivoId,
    p_usuarios: usuarios,
    p_leitura_ok: leituraOk,
  })

  // ⚠️ JANELA DE DEPLOY, e ela é real: o push na `main` dispara o deploy sozinho, e a migration
  // `20260906130000` é aplicada à mão. Entre um e outro, `p_leitura_ok` não existe no banco e
  // TODO snapshot de TODO relógio do parque falharia com 500 — a higiene e a Cobertura de Ponto
  // parariam de ser atualizadas em silêncio, do lado que ninguém olha.
  //
  // Por isso o retry sem o parâmetro, que reproduz exatamente o comportamento anterior (lista
  // vazia nunca reconcilia). O erro é REGISTRADO em vez de engolido: se esta linha aparecer no
  // log depois de a migration ter sido aplicada, é sinal de que ela não foi aplicada de verdade.
  //
  // Remover assim que `20260906130000` estiver em produção — é andaime, não desenho.
  if (error && /p_leitura_ok|PGRST202|42883|does not exist/i.test(error.message)) {
    console.error(
      'ATENÇÃO: fn_registrar_snapshot_usuarios_dispositivo ainda não aceita p_leitura_ok — '
      + 'a migration 20260906130000 não foi aplicada. Relógio zerado continua invisível. '
      + 'Detalhe: ' + error.message
    )
    ;({ data, error } = await supabase.rpc('fn_registrar_snapshot_usuarios_dispositivo', {
      p_dispositivo_id: auth.dispositivoId,
      p_usuarios: usuarios,
    }))
  }

  if (error) {
    console.error('Falha ao registrar snapshot de usuários do dispositivo:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, ...(data || {}) })
}
