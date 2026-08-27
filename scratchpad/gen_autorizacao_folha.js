/**
 * Aplica a observacao de autorizacao do RH nas QUATRO copias da geracao de folha.
 *
 * As quatro sao executeGerarFolhaPonto, sincronizarFolhaPonto (folha-ponto/actions.ts),
 * sincronizarFolhaPontoServidor e gerarFolhaPontoServidor (consultar-escala/actions.ts) — ver
 * "A folha e um snapshot" no CLAUDE.md. Elas ja divergiram entre si antes; por isso este script
 * ABORTA se qualquer contagem nao for exatamente a esperada.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const ARQ_FOLHA = path.join(RAIZ, 'src/app/(dashboard)/folha-ponto/actions.ts')
const ARQ_PORTAL = path.join(RAIZ, 'src/app/consultar-escala/actions.ts')

const conta = (t, p) => t.split(p).length - 1

function editar(arquivo, pares) {
  let s = fs.readFileSync(arquivo, 'utf8')
  const crlf = s.includes('\r\n')
  const n2 = t => (crlf ? t.replace(/\n/g, '\r\n') : t)

  for (const [alvo, novo, esperado, rotulo] of pares) {
    const a = n2(alvo)
    const n = conta(s, a)
    if (n !== esperado) throw new Error(`${path.basename(arquivo)} / ${rotulo}: esperava ${esperado}, achou ${n}`)
    s = s.split(a).join(n2(novo))
  }

  fs.writeFileSync(arquivo, s)
}

// ---------------------------------------------------------------------------
// 1. A busca das autorizacoes, logo depois da busca de afastamentos de cada copia.
//    O filtro por periodo e' o mesmo das outras: qualquer vigencia que toque o mes entra, e a
//    escolha do dia acontece em autorizacaoDoDia.
// ---------------------------------------------------------------------------
const BUSCA = (campoServidor) => `
    // Autorizacoes do RH para validacao coletiva (27/08/2026). A folha precisa IMPRIMIR o
    // oficio: sem ele o dia aparece como horario manual qualquer, e o documento e' justamente
    // o que responde a fiscalizacao. Nao preenche horario nenhum.
    const { data: autorizacoesPonto } = await supabase
      .from('autorizacoes_ponto_coletivo')
      .select('passos, documento, vigencia_inicio, vigencia_fim')
      .eq('servidor_id', ${campoServidor})
      .is('revogado_em', null)
      .lte('vigencia_inicio', endDate)
      .gte('vigencia_fim', startDate)
`

const APLICA = (nomePush) => `
      // A dispensa autorizada e' acrescentada por ULTIMO, depois de feriado/afastamento/ponto
      // facultativo terem montado a observacao — ela convive com eles, nao os substitui.
      aplicarObservacaoAutorizacao(registro, autorizacaoDoDia(autorizacoesPonto, dateStr))

      ${nomePush}.push(registro)`

// ---------------------------------------------------------------------------
// folha-ponto/actions.ts — executeGerarFolhaPonto e sincronizarFolhaPonto
// ---------------------------------------------------------------------------
editar(ARQ_FOLHA, [
  [
    `import { afastamentosDoDia, descreverAfastamentos`,
    `import { autorizacaoDoDia, aplicarObservacaoAutorizacao } from '@/utils/folha/autorizacaoPonto'\nimport { afastamentosDoDia, descreverAfastamentos`,
    1, 'import',
  ],
  [
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)
`,
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)
${BUSCA('servidorId')}`,
    1, 'busca (executeGerarFolhaPonto)',
  ],
  [
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .or(\`data_inicio.lte.\${endDate},data_fim.gte.\${startDate}\`)
`,
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .or(\`data_inicio.lte.\${endDate},data_fim.gte.\${startDate}\`)
${BUSCA('folha.servidor_id')}`,
    1, 'busca (sincronizarFolhaPonto)',
  ],
  [`\n      registros.push(registro)`, APLICA('registros'), 1, 'aplica (executeGerarFolhaPonto)'],
  [`\n      registrosAtualizados.push(registro)`, APLICA('registrosAtualizados'), 1, 'aplica (sincronizarFolhaPonto)'],
])

// ---------------------------------------------------------------------------
// consultar-escala/actions.ts — sincronizarFolhaPontoServidor e gerarFolhaPontoServidor
// ---------------------------------------------------------------------------
editar(ARQ_PORTAL, [
  [
    `import { afastamentosDoDia, descreverAfastamentos`,
    `import { autorizacaoDoDia, aplicarObservacaoAutorizacao } from '@/utils/folha/autorizacaoPonto'\nimport { afastamentosDoDia, descreverAfastamentos`,
    1, 'import',
  ],
  [
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)
`,
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', folha.servidor_id)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)
${BUSCA('folha.servidor_id')}`,
    1, 'busca (sincronizarFolhaPontoServidor)',
  ],
  [
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)
`,
    `      .select('data_inicio, data_fim, observacao, slots, periodo_tipo, hora_inicio, hora_fim, minutos_afastamento, regime_abono, tipos_eventos(nome)')
      .eq('servidor_id', servidorId)
      .lte('data_inicio', endDate)
      .gte('data_fim', startDate)
${BUSCA('servidorId')}`,
    1, 'busca (gerarFolhaPontoServidor)',
  ],
  [`\n      registrosAtualizados.push(registro)`, APLICA('registrosAtualizados'), 1, 'aplica (sincronizarFolhaPontoServidor)'],
  [`\n      registros.push(registro)`, APLICA('registros'), 1, 'aplica (gerarFolhaPontoServidor)'],
])

// ---------------------------------------------------------------------------
// Conferencia final: as QUATRO copias tem de ter ganhado busca E aplicacao.
// ---------------------------------------------------------------------------
for (const arq of [ARQ_FOLHA, ARQ_PORTAL]) {
  const s = fs.readFileSync(arq, 'utf8')
  const buscas = conta(s, "from('autorizacoes_ponto_coletivo')")
  const aplicacoes = conta(s, 'aplicarObservacaoAutorizacao(registro')
  if (buscas !== 2) throw new Error(`${path.basename(arq)}: esperava 2 buscas, achou ${buscas}`)
  if (aplicacoes !== 2) throw new Error(`${path.basename(arq)}: esperava 2 aplicacoes, achou ${aplicacoes}`)
  console.log(`${path.basename(arq)}: 2 buscas + 2 aplicacoes OK`)
}
