import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/utils/supabase/server'
import { executeGerarFolhaPonto } from '@/app/(dashboard)/folha-ponto/actions'

/**
 * Regera as folhas de ponto de UMA competência inteira, em lote.
 *
 * POR QUE ESTA ROTA EXISTE
 *   `folha_ponto.registros` é um snapshot jsonb, não uma view de `escala_diaria`: corrigir a
 *   escala NÃO corrige a folha. Depois de uma correção de dados que alcance muitos servidores
 *   (a 20260823100000, por exemplo), alguém precisa regerar — e a tela só regera a unidade que
 *   estiver filtrada. Para um perfil irrestrito ela exige escolher uma unidade antes de listar,
 *   então "regerar o município" viravam dezenas de cliques, um por unidade.
 *
 *   Reusa `executeGerarFolhaPonto`, a MESMA função da tela e do cron. Nenhuma regra de folha é
 *   reescrita aqui — replicar o gerador por fora é como se erra o ramo `else if (!shift)` e se
 *   produz folha errada em massa.
 *
 * SÓ MEXE EM RASCUNHO
 *   Folha em `Gerada`/`Revisada`/`Fechada` é pulada e reportada. Regerar uma folha revisada como
 *   rascunho a rebaixaria — perda silenciosa de trabalho do coordenador. Competência encerrada
 *   também é recusada, pela mesma checagem que `executeGerarFolhaPonto` já faz.
 *
 * AUTORIZAÇÃO
 *   Aceita `CRON_SECRET` ou `SUPABASE_SERVICE_ROLE_KEY` no `Authorization: Bearer`. A segunda não
 *   amplia privilégio nenhum: quem a possui já escreve direto em qualquer tabela pelo PostgREST,
 *   inclusive em `folha_ponto`. Sem NENHUMA das duas variáveis no ambiente, a rota devolve 500 —
 *   nunca um segredo embutido, que num repositório público é um segredo publicado (armadilha 18).
 */

function segredoConfere(fornecido: string, esperado: string): boolean {
  const a = Buffer.from(fornecido)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  try {
    const aceitos = [process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(
      (s): s is string => !!s
    )
    if (aceitos.length === 0) {
      return NextResponse.json(
        { error: 'Nem CRON_SECRET nem SUPABASE_SERVICE_ROLE_KEY estão configurados no ambiente.' },
        { status: 500 }
      )
    }

    const authHeader = request.headers.get('authorization')
    const fornecido = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
    if (!fornecido || !aceitos.some(s => segredoConfere(fornecido, s))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const mes = Number(body?.mes)
    const ano = Number(body?.ano)
    const unidadeId: string | undefined = body?.unidade_id || undefined
    // Ensaio por padrão: só relata o que faria. Escrever exige pedir explicitamente.
    const aplicar = body?.aplicar === true

    if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(ano)) {
      return NextResponse.json({ error: 'Informe mes (1-12) e ano.' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    let q = supabase
      .from('escala_mensal')
      .select('id, servidor_id, unidade_id')
      .eq('mes', mes)
      .eq('ano', ano)
      .eq('ativo', true)
    if (unidadeId) q = q.eq('unidade_id', unidadeId)
    const { data: escalas, error: errEscalas } = await q
    if (errEscalas) throw errEscalas
    if (!escalas || escalas.length === 0) {
      return NextResponse.json({ error: 'Nenhuma escala ativa nesta competência.' }, { status: 404 })
    }

    const { data: folhas, error: errFolhas } = await supabase
      .from('folha_ponto')
      .select('escala_mensal_id, status')
      .eq('mes', mes)
      .eq('ano', ano)
    if (errFolhas) throw errFolhas
    const statusPorEscala = new Map<string, string>(
      (folhas || []).map((f: any) => [f.escala_mensal_id, f.status])
    )

    const alvos = escalas.filter(e => {
      const st = statusPorEscala.get(e.id)
      return st === undefined || st === 'Rascunho'
    })
    const pulados = escalas.length - alvos.length

    if (!aplicar) {
      return NextResponse.json({
        ensaio: true,
        mes, ano,
        escalas_ativas: escalas.length,
        seriam_regeradas: alvos.length,
        puladas_por_status: pulados,
        detalhe: 'Envie { "aplicar": true } para gravar.',
      })
    }

    let regeradas = 0
    const erros: { escala_mensal_id: string; erro: string }[] = []
    for (const e of alvos) {
      try {
        const res = await executeGerarFolhaPonto(
          supabase, e.servidor_id, mes, ano, 'Rascunho', e.id, null
        )
        if (res?.success) regeradas++
        else erros.push({ escala_mensal_id: e.id, erro: String(res?.error || 'falhou') })
      } catch (err: any) {
        erros.push({ escala_mensal_id: e.id, erro: String(err?.message || err) })
      }
    }

    return NextResponse.json({
      success: true,
      mes, ano,
      escalas_ativas: escalas.length,
      regeradas,
      puladas_por_status: pulados,
      falhas: erros.length,
      erros: erros.slice(0, 20),
    })
  } catch (error: any) {
    console.error('Erro ao regerar competência:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
