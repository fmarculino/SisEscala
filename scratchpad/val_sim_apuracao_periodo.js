// Validador do portao sim_apuracao_periodo.js: injeta regressoes de proposito e EXIGE reprovacao.
//
// A primeira injecao e O defeito que este modulo existe para impedir: aplicar a regua de uma
// competencia aos dias da outra. Em producao isso vale -40h nas 4 apuracoes do Mais Medicos, num
// documento que o servidor assina.
//
// ⚠️ As ancoras sao o texto do JS COMPILADO. Cada injecao confere que a substituicao foi APLICADA
// antes de rodar o portao: `replace` que nao casa e no-op silencioso, e o validador "passaria"
// sem ter testado nada (CLAUDE.md armadilha 48).
//
// Uso: node scratchpad/val_sim_apuracao_periodo.js
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ALVO = path.join(__dirname, '_sim', 'apuracaoPeriodo.js')
const PORTAO = path.join(__dirname, 'sim_apuracao_periodo.js')
const original = fs.readFileSync(ALVO, 'utf8')

const REGRESSOES = [
  {
    nome: '🚨 a regua de UMA competencia aplicada ao periodo todo (-40h no documento real)',
    // Resolve a vigencia sempre pelo mes da COMPETENCIA que fecha, em vez do mes da metade.
    de: "const descontaIntervalo = (0, calculoDia_1.horasNormaisLiquidasVigente)(recorte.mes, recorte.ano, opcoes.horasLiquidasDesde);",
    para: "const descontaIntervalo = (0, calculoDia_1.horasNormaisLiquidasVigente)(janela.fim.slice(5, 7) * 1, janela.fim.slice(0, 4) * 1, opcoes.horasLiquidasDesde);"
  },
  {
    nome: 'carga por dia fixa em 8h (ignora a jornada e a vigencia da metade)',
    de: "const horasNormaisPorDia = (0, cargaDiaria_1.horasNormaisDaJornada)(jornada, descontaIntervalo);",
    para: "const horasNormaisPorDia = 8;"
  },
  {
    nome: 'ordena por numero de dia (setembro antes de agosto)',
    de: "dias.sort((a, b) => a.data.localeCompare(b.data));",
    para: "dias.sort((a, b) => a.dia - b.dia);"
  },
  {
    nome: 'so a PRIMEIRA folha da competencia entra (perde a escala dividida)',
    de: "        for (const f of daMetade) {\n            for (const r of f.registros || []) {",
    para: "        for (const f of daMetade.slice(0, 1)) {\n            for (const r of f.registros || []) {"
  },
  {
    nome: 'so a ULTIMA lotacao vai no documento',
    de: "            if (!lotacoes.some(l => l.competencia === competencia && l.unidade_nome === u && l.setor_nome === s)) {",
    para: "            lotacoes.length = 0;\n            if (true) {"
  },
  {
    nome: 'metade sem folha nao vira lacuna (documento parcial fingindo estar completo)',
    de: "        if (!daMetade.length) {",
    para: "        if (false) {"
  },
  {
    nome: 'parcial nunca e sinalizado',
    de: "        parcial: metades.some(m => m.semFolha),",
    para: "        parcial: false,"
  },
  {
    nome: 'pendencia perde a competencia (dia 5 das duas metades fica ambiguo)',
    de: "                competencia, tipo: 'compensacao', dias: [...totaisMetade.pendentesCompensacao],",
    para: "                competencia: '', tipo: 'compensacao', dias: [...totaisMetade.pendentesCompensacao],"
  },
  {
    nome: 'o recorte deixa vazar dia de fora do periodo',
    de: "                if (d >= recorte.diaInicio && d <= recorte.diaFim)",
    para: "                if (true)"
  },
  {
    nome: 'requerConfirmacao sempre libera (emite numero que ainda vai mudar)',
    de: "    return { precisa: motivos.length > 0, motivos };",
    para: "    return { precisa: false, motivos };"
  },
  {
    // A injecao apaga UM campo (a entrada). A primeira versao do portao testava so a `saida` e
    // deixou isto escapar — por isso hoje ele testa os 8 campos do dia, um a um.
    nome: 'fingerprint ignora a ENTRADA (folha muda e o documento nao percebe)',
    de: "        return [\n            d.data,\n            r.entrada || '',",
    para: "        return [\n            d.data,\n            '',"
  },
  {
    nome: 'fingerprint ignora a hora extra do dia',
    de: "            Number(r.hora_extra_minutos) || 0,",
    para: "            0,"
  },
  // ℹ️ NAO ha injecao para "dia sem registro vira string vazia": ela ESCAPOU, e com razao. As
  // linhas sao unidas por \n numa lista de tamanho e ordem fixos, entao a POSICAO ja identifica o
  // dia — `2026-09-01|-` e `''` tem o mesmo poder de deteccao. O `${d.data}|-` fica por
  // legibilidade do texto hasheado, nao por necessidade.
  {
    nome: 'fingerprint entra o id da folha (sincronizar vira divergencia falsa)',
    de: "    const texto = `${a.janela.inicio}..${a.janela.fim}\\n${linhas.join('\\n')}`;",
    para: "    const texto = `${a.janela.inicio}..${a.janela.fim}\\n${linhas.join('\\n')}\\n${a.metades.map(m => m.folhas.map(f => f.id).join()).join()}`;"
  },
  // ℹ️ NAO ha injecao para "fingerprint ignora a janela": ela ESCAPOU do portao, e com razao —
  // cada linha ja carrega `d.data`, entao periodos diferentes tem dias diferentes e o hash muda
  // de todo jeito. A janela no texto e redundante (fica por robustez e leitura), e injecao que
  // nao muda comportamento observavel e injecao inutil (CLAUDE.md armadilhas 48 e 57).
  {
    nome: 'compararComEmitido diz "divergente" sem dizer o que mudou',
    de: "    if (!diferencas.length) {",
    para: "    if (false) {"
  },
  {
    nome: 'diasComLinha conta todos os dias (a conferencia do banco deixaria passar)',
    de: "    return a.dias.filter(d => d.registro).length;",
    para: "    return a.dias.length;"
  },
]

function portaoPassa() {
  try { execFileSync(process.execPath, [PORTAO], { stdio: 'pipe' }); return true }
  catch { return false }
}

console.log('Conferindo que o portao passa com o codigo intacto...')
if (!portaoPassa()) {
  console.error('REPROVA: o portao nao passa nem com o codigo original. Corrija antes de validar.')
  process.exit(1)
}
console.log('  ok\n')

let pegas = 0, escaparam = 0
for (const r of REGRESSOES) {
  const injetado = original.replace(r.de, r.para)

  if (injetado === original) {
    console.error(`  ANCORA NAO CASOU: ${r.nome}`)
    console.error('    a injecao foi no-op — o portao nao foi exercitado. Reveja a ancora.')
    escaparam++
    continue
  }

  fs.writeFileSync(ALVO, injetado)
  const passou = portaoPassa()
  fs.writeFileSync(ALVO, original)

  if (passou) { console.error(`  ESCAPOU: ${r.nome}`); escaparam++ }
  else { console.log(`  pega: ${r.nome}`); pegas++ }
}

fs.writeFileSync(ALVO, original)
console.log(`\n${escaparam === 0 ? 'OK' : 'REPROVADO'}: ${pegas} de ${REGRESSOES.length} regressoes reprovadas, ${escaparam} escaparam.`)
process.exit(escaparam === 0 ? 0 : 1)
