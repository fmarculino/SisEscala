/**
 * Intervalo intrajornada — espelho do banco, em fonte única para o frontend.
 *
 * O BANCO É A AUTORIDADE. Isto existe só porque a grade desenha os segmentos de presença de uma
 * célula antes de qualquer chamada ao servidor. Toda regra aqui espelha, uma a uma:
 *
 *   public.fn_intervalo_minimo_legal(duracao)                → intervaloMinimoLegal
 *   public.fn_intervalo_previsto_minutos(cat, dur, jor, tur) → intervaloPrevistoMinutos
 *   public.fn_jornada_tem_intervalo(duracao, intervalo)      → temIntervaloIntrajornada
 *
 * Se você mudar qualquer uma delas no SQL, mude a gêmea aqui. Divergir faz a grade desenhar 2
 * segmentos onde o terminal espera 4 (ou o contrário) — e o sintoma é a batida do servidor cair
 * em `fora_da_janela` sem que nada na tela indique por quê.
 *
 * A REGRA, E DE ONDE ELA VEM
 *   CLT Art. 71, caput: "Em qualquer trabalho contínuo, cuja duração exceda de 6 (seis) horas, é
 *   obrigatória a concessão de um intervalo [...] no mínimo, de 1 (uma) hora".
 *
 *   A âncora é a duração do TRABALHO CONTÍNUO, não o contrato de quem trabalhou. Um plantão de
 *   12h é trabalho contínuo de 12h, seja de quem for — por isso o intervalo dele vem do turno
 *   (`dicionario_turnos.intervalo_minutos`) e não da jornada Regular do servidor.
 *
 *   Até 22/08/2026 vinha da jornada, e como toda jornada de até 6h tem `intervalo_minutos = 0`,
 *   esse zero suprimia o intervalo de 106 plantões de mais de 6h medidos em produção. Duas
 *   servidoras no mesmo sábado, no mesmo turno MT de 12h: uma com janela de intervalo, a outra
 *   sem, só porque os expedientes delas eram diferentes.
 *
 * A FRONTEIRA É DECISÃO DO USUÁRIO (22/08/2026)
 *   Jornada de até 6h não tem intervalo de ponto: registra só entrada e saída. Por isso a faixa
 *   de 15 minutos do Art. 71 §1º (acima de 4h e até 6h) NÃO é implementada — nem aqui nem no SQL.
 */

/** Categoria do turno, como vive em `escala_diaria.categoria`. */
export type CategoriaTurno = 'Regular' | 'Plantão' | 'Extra' | 'Sobreaviso' | string

/** Acima de 6h (360 min) o mínimo legal é 1 hora. Até lá, nenhum. */
export function intervaloMinimoLegal(duracaoMinutos: number): number {
  return (duracaoMinutos || 0) > 360 ? 60 : 0
}

/**
 * Quantos minutos de intervalo este turno prevê.
 *
 * `Regular` lê a jornada do servidor (o intervalo é propriedade do expediente); `Plantão` e
 * `Extra` leem o dicionário de turnos (é propriedade do turno). Nenhum dos dois cai abaixo do
 * piso legal — é o `GREATEST` que impede o zero de uma jornada de 6h de anular o intervalo de
 * um plantão de 12h.
 *
 * Os defaults não são iguais de propósito: `Regular` cai em 60 para preservar exatamente o
 * `COALESCE(j.intervalo_minutos, 60)` que os cursores do banco sempre usaram quando não há
 * jornada casada; `Plantão`/`Extra` caem em 0 porque o piso já garante o mínimo pela duração, e
 * um default de 60 daria intervalo a turno curto que não tem direito a ele.
 */
export function intervaloPrevistoMinutos(
  categoria: CategoriaTurno,
  duracaoMinutos: number,
  jornadaIntervaloMinutos: number | null | undefined,
  turnoIntervaloMinutos: number | null | undefined
): number {
  const cadastrado = categoria === 'Regular'
    ? Number(jornadaIntervaloMinutos ?? 60)
    : Number(turnoIntervaloMinutos ?? 0)

  return Math.max(cadastrado, intervaloMinimoLegal(duracaoMinutos))
}

/** Espelha `public.fn_jornada_tem_intervalo`: duração > 360 min E intervalo > 0. */
export function temIntervaloIntrajornada(duracaoMinutos: number, intervaloMinutos: number): boolean {
  return (duracaoMinutos || 0) > 360 && (intervaloMinutos || 0) > 0
}

/**
 * A célula da grade deve desenhar 4 segmentos (entrada · saída int. · retorno int. · saída) ou
 * só 2? Junta as três condições que o banco também junta, na mesma ordem:
 *
 *   1. só `Regular` e `Plantão` têm passos de intervalo;
 *   2. a unidade precisa exigir a marcação (`unidades.permite_marca_intervalo`);
 *   3. duração e intervalo previsto precisam passar por `temIntervaloIntrajornada`.
 *
 * `duracaoMinutos` é a duração do TURNO quando a categoria não é `Regular` — ou seja,
 * `dicionario_turnos.horas_computadas × 60`, nunca `jornadas.horas_totais`.
 */
export function celulaTemPassosDeIntervalo(params: {
  categoria: CategoriaTurno
  duracaoMinutos: number
  permiteMarcaIntervalo: boolean | null | undefined
  jornadaIntervaloMinutos: number | null | undefined
  turnoIntervaloMinutos: number | null | undefined
}): boolean {
  const { categoria, duracaoMinutos, permiteMarcaIntervalo } = params

  if (categoria !== 'Regular' && categoria !== 'Plantão') return false
  if (!permiteMarcaIntervalo) return false

  return temIntervaloIntrajornada(
    duracaoMinutos,
    intervaloPrevistoMinutos(
      categoria,
      duracaoMinutos,
      params.jornadaIntervaloMinutos,
      params.turnoIntervaloMinutos
    )
  )
}
