import { createAdminClient } from '@/utils/supabase/server'
import { enviarEmailInterno } from '@/utils/comunicacao/enviar'
import { h } from '@/utils/htmlSeguro'

/**
 * Vigilância diária da coleta de ponto.
 *
 * 🚨 Existe porque o caso que a motivou foi descoberto por SERVIDORES RECLAMANDO. Em 18/09/2026 o
 * REP-iDClass-HMI-01 ficou 38 horas sem ingerir uma batida — 509 marcações, 267 delas do dia 18
 * inteiro — e nada no sistema disse nada. A tela mostrava `Online` e um NSR alto, que são os dois
 * indicadores tranquilizadores. Uma ferramenta de *investigação* não encurta isso: investigar é,
 * por definição, alguém indo procurar depois de desconfiar.
 *
 * ⚠️ Os três sinais vêm de `fn_vigilancia_coleta_parque` e NÃO são recalculados aqui. A tela de
 * Marcações lê a mesma função — duas implementações da mesma pergunta divergem na primeira
 * mudança, e aí o e-mail passa a dizer uma coisa e a tela outra.
 */

/** Uma linha de `fn_vigilancia_coleta_parque`, só o que este módulo usa. */
type LinhaVigilancia = {
  dispositivo_nome: string
  unidade_nome: string | null
  coletor_host: string | null
  horas_sem_contato: number | null
  nsr_faltando: number | null
  batidas_presas: number | null
  severidade: number
  motivo: string | null
}

export type ResultadoVigilancia = {
  success: boolean
  /** Relógios avaliados (não é o número de problemas). */
  avaliados: number
  /** Relógios com ponto registrado que não chegou — severidade 2. */
  comPontoParado: number
  /** Relógios cuja máquina não coleta há tempo demais — severidade 1. */
  semColeta: number
  /** Destes, quantos entraram no e-mail. Ver `HORAS_PARA_AVISAR_SEM_COLETA`. */
  semColetaNoAviso: number
  /** Unidades no aviso. O e-mail agrupa por unidade, não por relógio. */
  unidadesAfetadas: number
  avisoEnviado: boolean
  error?: string
}

/**
 * 🚨 Máquina parada há algumas horas NÃO entra no e-mail, e o número saiu de medição.
 *
 * Medido em produção no sábado 19/09/2026, antes do primeiro envio: **18 dos 35 relógios** teriam
 * entrado por "sem coletar há ≥6h", em 16 unidades — e **15 deles estavam na faixa de 12 a 24h**,
 * ou seja, máquinas de USF desligadas desde a noite de sexta. Isso é o funcionamento normal de
 * uma unidade que fecha no fim de semana.
 *
 * Um primeiro aviso com 16 unidades por algo normal ensina a ignorar o aviso — e aí o dia em que
 * ele trouxer o caso do HMI ninguém abre. O e-mail leva o que EXIGE AÇÃO; a tela continua
 * mostrando tudo, que é onde o detalhe pertence.
 *
 * ⚠️ 24h é "não ligou no dia seguinte", não "está fora agora". Com o critério novo, o mesmo
 * sábado produziria 2 relógios em vez de 18.
 */
const HORAS_PARA_AVISAR_SEM_COLETA = 24

/**
 * ⚠️ Agrupar por UNIDADE, não por relógio, é regra e não estética: o HMI tem 3 equipamentos na
 * mesma máquina e uma máquina desligada avisaria 3 vezes pelo mesmo problema. Alarme repetido
 * ensina a ignorar o alarme.
 */
function agruparPorUnidade(linhas: LinhaVigilancia[]): Map<string, LinhaVigilancia[]> {
  const mapa = new Map<string, LinhaVigilancia[]>()
  for (const l of linhas) {
    const chave = l.unidade_nome || 'Sem unidade'
    if (!mapa.has(chave)) mapa.set(chave, [])
    mapa.get(chave)!.push(l)
  }
  return mapa
}

function montarHtml(porUnidade: Map<string, LinhaVigilancia[]>, comPontoParado: number): string {
  const secoes = [...porUnidade.entries()].map(([unidade, linhas]) => h`
    <h3 style="margin:18px 0 6px;font-size:15px;color:#18181b">${unidade}</h3>
    <ul style="margin:0;padding-left:18px;color:#3f3f46;font-size:13px;line-height:1.6">
      ${linhas.map((l) => h`<li>
        <strong>${l.dispositivo_nome}</strong> — ${l.motivo || 'sem detalhe'}
        ${l.coletor_host ? h` <span style="color:#71717a">(máquina ${l.coletor_host})</span>` : ''}
      </li>`)}
    </ul>`)

  return String(h`
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px">
      <h2 style="font-size:17px;color:#18181b;margin:0 0 4px">Ponto registrado que ainda não chegou ao SisEscala</h2>
      <p style="color:#52525b;font-size:13px;margin:0 0 12px">
        Verificação automática diária do parque de relógios de ponto.
      </p>
      ${comPontoParado > 0
        ? h`<p style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 12px;color:#991b1b;font-size:13px;margin:0 0 8px">
            <strong>${String(comPontoParado)} relógio(s) têm batidas registradas que não chegaram.</strong>
            As batidas estão gravadas no equipamento e entram sozinhas quando a coleta destravar —
            não há ponto perdido, e ninguém deve digitar horário à mão por causa disto. Enquanto
            não entram, a grade desses servidores fica sem presença.
          </p>`
        : h`<p style="background:#fffbeb;border-left:3px solid #d97706;padding:10px 12px;color:#92400e;font-size:13px;margin:0 0 8px">
            Nenhum ponto parado detectado, mas há máquinas que não coletam <strong>há mais de um
            dia</strong> — enquanto estiverem fora, não há como saber se há batida esperando.
          </p>`}
      ${secoes}
      <p style="color:#71717a;font-size:12px;margin-top:18px">
        Detalhe por equipamento em Marcações → Dispositivos REP.
      </p>
    </div>`)
}

/**
 * Roda a verificação e, havendo o que dizer, manda um e-mail.
 *
 * ⚠️ Chamada de MÁQUINA (cron): usa `createAdminClient`, e `fn_vigilancia_coleta_parque` passa com
 * `auth.uid() IS NULL`, devolvendo o parque inteiro. É o que se quer aqui — o aviso é do parque,
 * não de um escopo de usuário.
 */
export async function vigiarColetaDoParque(): Promise<ResultadoVigilancia> {
  const base: ResultadoVigilancia = {
    success: false, avaliados: 0, comPontoParado: 0, semColeta: 0, semColetaNoAviso: 0,
    unidadesAfetadas: 0, avisoEnviado: false,
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase.rpc('fn_vigilancia_coleta_parque')
  if (error) return { ...base, error: error.message }

  const linhas = (data || []) as LinhaVigilancia[]
  const pontoParado = linhas.filter((l) => Number(l.severidade) === 2)
  const semColeta = linhas.filter((l) => Number(l.severidade) === 1)

  // O que vai no e-mail: tudo que tem ponto registrado esperando, mais as máquinas que não ligam
  // há mais de um dia. O resto fica na tela. Ver HORAS_PARA_AVISAR_SEM_COLETA.
  const semColetaNoAviso = semColeta.filter((l) => Number(l.horas_sem_contato) >= HORAS_PARA_AVISAR_SEM_COLETA)
  const noAviso = [...pontoParado, ...semColetaNoAviso]

  const resultado: ResultadoVigilancia = {
    ...base,
    success: true,
    avaliados: linhas.length,
    comPontoParado: pontoParado.length,
    // ⚠️ `semColeta` é o MEDIDO e `semColetaNoAviso` é o AVISADO — os dois separados de propósito.
    // Reportar só um dos dois esconderia metade do que aconteceu (armadilha 22).
    semColeta: semColeta.length,
    semColetaNoAviso: semColetaNoAviso.length,
    unidadesAfetadas: agruparPorUnidade(noAviso).size,
  }

  if (noAviso.length === 0) return resultado

  // ⚠️ Destinatários vêm de `configuracoes_globais`. Sem a chave configurada a verificação roda e
  // NÃO envia — o resultado ainda sai na resposta do cron, que é onde a falha fica visível. Um
  // aviso sem destinatário é o mesmo silêncio de antes, com mais código; por isso o campo
  // `avisoEnviado` existe separado de `success`.
  const { data: cfg } = await supabase
    .from('configuracoes_globais')
    .select('valor')
    .eq('chave', 'vigilancia_ponto_emails')
    .maybeSingle()

  const bruto = typeof cfg?.valor === 'string' ? cfg.valor : (cfg?.valor ?? '')
  const destinatarios = String(bruto).split(/[;,\s]+/).map((e) => e.trim()).filter((e) => e.includes('@'))
  if (destinatarios.length === 0) return resultado

  const assunto = pontoParado.length > 0
    ? `[SisEscala] ${pontoParado.length} relógio(s) com ponto que não chegou`
    : `[SisEscala] ${semColetaNoAviso.length} relógio(s) sem coletar há mais de um dia`

  const envio = await enviarEmailInterno({
    to: destinatarios.join(','),
    subject: assunto,
    html: montarHtml(agruparPorUnidade(noAviso), pontoParado.length),
  })

  // Falha de envio não derruba a verificação: o número medido continua valendo e sai no retorno.
  if (!envio.success) return { ...resultado, error: `aviso não enviado: ${envio.error || 'erro no SMTP'}` }
  return { ...resultado, avisoEnviado: true }
}
