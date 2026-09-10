/**
 * Portao dos TOTAIS DA GRADE de escala — colunas CH / HE100 / HE50 / PL12 / PL6 / PL4 / SOB e
 * TOTAL H/MES (09/09/2026).
 *
 * O QUE ESTE PORTAO EXISTE PARA IMPEDIR
 *
 *   1. A grade voltar a somar o Regular SEM o teto liquido da jornada. Ate 09/09/2026 as
 *      jornadas so chegavam pelo fetch do cliente, com o estado comecando VAZIO: no primeiro
 *      paint `calculateTotals` nao achava a jornada, nao aplicava teto nenhum, e a coluna CH
 *      nascia com a soma BRUTA de horas_computadas — caindo sozinha alguns instantes depois.
 *      Era o "atualizo a pagina, aparece o valor certo e logo volta ao antigo" relatado em campo.
 *
 *   2. `calculateTotals` voltar a ser uma COPIA da regra de horas. A fonte unica e
 *      src/utils/escala/horasLinha.ts — a mesma do /home, do /relatorios/consolidado e o mesmo
 *      LEAST de fn_carga_mensal_servidor. Copias divergentes ja produziram 37.223h de diferenca
 *      entre duas telas do mesmo sistema (armadilha 52).
 *
 *   3. O dia de hoje voltar a sair de `new Date().getDate()`. A grade e renderizada TAMBEM no
 *      servidor e o container roda em UTC (armadilha 12): depois das 21h o `isPast` da coluna
 *      VAL divergia entre o HTML do servidor e o do navegador, e no cliente lia o fuso da
 *      MAQUINA de quem abriu a tela.
 *
 *   4. O teto da jornada voltar a ser SILENCIOSO. Numa jornada de 6h, trocar `M` (6h) por `MT`
 *      (12h) na linha Regular nao move coluna nenhuma nem o total — as duas valem 6h. Isso esta
 *      CERTO e nao vai embora; o que nao pode e a tela nao dizer por que (armadilha 22).
 *
 * Roda a conta de verdade sobre a fonte unica e varre o codigo da grade.
 *
 *   npx tsc src/utils/escala/horasLinha.ts src/utils/plantaoUnidades.ts \
 *     --outDir scratchpad/_sim --module commonjs --target es2020
 *   node scratchpad/sim_totais_grade.js
 */
const fs = require('fs')
const path = require('path')
const { horasDaLinhaEscala, tetoLiquidoJornada } = require('./_sim/escala/horasLinha.js')
const { decomporPlantao } = require('./_sim/plantaoUnidades.js')

let ok = 0, falhas = 0
function checa(rotulo, cond) {
  if (cond) { ok++ } else { falhas++; console.log('  FALHOU: ' + rotulo) }
}
function igual(rotulo, a, b) {
  if (a === b) { ok++ } else { falhas++; console.log('  FALHOU: ' + rotulo + ' -> esperava ' + b + ', veio ' + a) }
}

// ---------------------------------------------------------------------------------------
// PARTE 1 — A CONTA. Replica calculateTotals em cima da fonte unica.
// ---------------------------------------------------------------------------------------

function totais(jornada, dias) {
  let p_ch = 0, p_chBruto = 0, p_chDiasLimitados = 0
  for (const h of dias.Regular || []) {
    const liq = horasDaLinhaEscala('Regular', h, jornada)
    p_chBruto += h
    if (liq < h) p_chDiasLimitados += 1
    p_ch += liq
  }
  let p_he100 = 0, p_he50 = 0
  for (const e of dias.Extra || []) { if (e.cem) p_he100 += e.horas; else p_he50 += e.horas }
  let p_pl12 = 0, p_pl6 = 0, p_pl4 = 0, p_plAvulso = 0
  for (const p of dias.Plantao || []) {
    const d = decomporPlantao(p.codigo, p.horas)
    p_pl12 += d.pl12; p_pl6 += d.pl6; p_pl4 += d.pl4; p_plAvulso += d.horasAvulsas
  }
  const p_soQtd = dias.Sob || 0
  return {
    p_ch, p_chBruto, p_chDiasLimitados, p_chDescontado: Math.max(0, p_chBruto - p_ch),
    p_he100, p_he50, p_pl12, p_pl6, p_pl4, p_plAvulso, p_soQtd,
    totalPlanejado: p_ch + p_he100 + p_he50 + (p_pl12 * 12) + (p_pl6 * 6) + (p_pl4 * 4) + p_plAvulso,
  }
}

const J6 = { horas_totais: 6, intervalo_minutos: 0 }       // "07H AS 13H"
const J10 = { horas_totais: 10, intervalo_minutos: 120 }   // "08H AS 18H" -> liquido 8h

console.log('1. O teto do Regular')
igual('jornada de 6h: teto liquido de 6h', tetoLiquidoJornada(J6), 6)
igual('08H AS 18H: teto e 8h, nunca o vao bruto de 10h', tetoLiquidoJornada(J10), 8)
igual('jornada sem carga cadastrada: SEM teto (null), nunca 8h de fallback',
  tetoLiquidoJornada({ horas_totais: 0 }), null)
igual('turno REDUZIDO nao e inflado ate o teto (M4 vale 4h numa jornada de 8h)',
  horasDaLinhaEscala('Regular', 4, J10), 4)
igual('turno LONGO e limitado (MT de 12h numa jornada de 6h)',
  horasDaLinhaEscala('Regular', 12, J6), 6)
igual('Plantao NAO tem teto de jornada', horasDaLinhaEscala('Plantão', 12, J6), 12)
igual('Extra NAO tem teto de jornada', horasDaLinhaEscala('Extra', 12, J6), 12)
igual('Sobreaviso nao entra na carga de horas', horasDaLinhaEscala('Sobreaviso', 12, J6), 0)

console.log('2. O caso relatado em 09/09/2026 (jornada 07H AS 13H)')
const soM = totais(J6, { Regular: Array(19).fill(6) })
const comMT = totais(J6, { Regular: Array(18).fill(6).concat([12]) })
igual('19 dias de M numa jornada de 6h = 114h', soM.p_ch, 114)
igual('trocar um M por um MT NAO muda a CH — e correto', comMT.p_ch, 114)
igual('...mas o lancado bruto sobe para 120h', comMT.p_chBruto, 120)
igual('...entao a tela tem o que dizer: 6h acima do limite', comMT.p_chDescontado, 6)
igual('...em 1 dia', comMT.p_chDiasLimitados, 1)
igual('SEM jornada carregada a mesma grade daria 120 — o numero que piscava',
  totais(null, { Regular: Array(18).fill(6).concat([12]) }).p_ch, 120)
igual('sem nenhum turno acima do limite nao ha o que explicar', soM.p_chDescontado, 0)
igual('...nem dia limitado', soM.p_chDiasLimitados, 0)

console.log('3. O TOTAL fecha com as colunas')
const caso = totais(J6, {
  Regular: Array(19).fill(6),
  Extra: [{ horas: 6, cem: false }, { horas: 6, cem: false }, { horas: 6, cem: false }],
  Plantao: [
    { codigo: 'MT4', horas: 10 }, { codigo: 'MT4', horas: 10 }, { codigo: 'MT4', horas: 10 },
    { codigo: 'T4', horas: 4 }, { codigo: 'MT', horas: 12 }, { codigo: 'MT', horas: 12 },
  ],
})
igual('CH', caso.p_ch, 114)
igual('HE50', caso.p_he50, 18)
igual('total = CH + HE + PL12*12 + PL6*6 + PL4*4 + avulsas',
  caso.totalPlanejado,
  caso.p_ch + caso.p_he100 + caso.p_he50 + caso.p_pl12 * 12 + caso.p_pl6 * 6 + caso.p_pl4 * 4 + caso.p_plAvulso)
igual('Sobreaviso NAO entra no total de horas',
  totais(J6, { Regular: [6], Sob: 5 }).totalPlanejado, 6)

const m7 = totais(J6, { Plantao: [{ codigo: 'M7', horas: 7 }] })
igual('M7 (7h) = 1 x PL6', m7.p_pl6, 1)
igual('...mais 1h avulsa, que NAO aparece em coluna nenhuma', m7.p_plAvulso, 1)
igual('...e mesmo assim nao some do total', m7.totalPlanejado, 7)

const mtn = totais(J6, { Plantao: [{ codigo: 'MTN', horas: 24 }] })
igual('MTN (24h) = 2 x PL12, nunca 1 (armadilha 16)', mtn.p_pl12, 2)
igual('...total 24h', mtn.totalPlanejado, 24)

// ---------------------------------------------------------------------------------------
// PARTE 2 — O CODIGO DA GRADE. Invariantes que conta nenhuma pega.
// ---------------------------------------------------------------------------------------
console.log('4. Invariantes da grade')
const raiz = path.join(__dirname, '..')
const dir = 'src/app/(dashboard)/escalas/unidade/[unidadeId]'
const grade = fs.readFileSync(path.join(raiz, dir, 'ScaleGrid.tsx'), 'utf8')
const pagina = fs.readFileSync(path.join(raiz, dir, 'page.tsx'), 'utf8')

checa('page.tsx busca as jornadas no SERVIDOR', /from\('jornadas'\)/.test(pagina))
checa('page.tsx passa jornadasIniciais para a grade', /jornadasIniciais=\{jornadas/.test(pagina))
checa('a grade NAO inicializa jornadas com lista vazia (a causa do piscar)',
  /const \[jornadas, setJornadas\] = useState<any\[\]>\(jornadasIniciais\)/.test(grade))
checa('a grade importa a fonte unica de horas',
  /from '@\/utils\/escala\/horasLinha'/.test(grade))

const iniCalc = grade.indexOf('const calculateTotals =')
const fimCalc = grade.indexOf('const avaliarCargaDoServidor')
checa('achei o corpo de calculateTotals', iniCalc > 0 && fimCalc > iniCalc)
const corpo = grade.slice(iniCalc, fimCalc)

checa('calculateTotals usa horasDaLinhaEscala para o Regular',
  /horasDaLinhaEscala\('Regular', shiftHours, jornada\)/.test(corpo))
checa('calculateTotals nao reimplementa o teto a mao',
  !/Math\.min\(shiftHours/.test(corpo) && !/journeyMaxLiquid/.test(corpo))
checa('Plantao e Extra continuam SEM teto de jornada',
  !/horasDaLinhaEscala\('Plantão'/.test(corpo) && !/horasDaLinhaEscala\('Extra'/.test(corpo))
checa('calculateTotals nao le a data pelo fuso do processo',
  !/new Date\(\)/.test(corpo))
checa('calculateTotals tira hoje do helper de fuso',
  /hojeNoFusoDoSistema\(\)/.test(corpo) && /hoje\.dia/.test(corpo) &&
  /hoje\.mes/.test(corpo) && /hoje\.ano/.test(corpo))
checa('calculateTotals expoe quanto o teto descontou', /p_chDescontado/.test(corpo))

checa('o helper de hoje sai de partesLocais, no fuso configurado',
  /function hojeNoFusoDoSistema\(\)/.test(grade) && /partesLocais\(new Date\(\)\)/.test(grade))
// A grade fica aberta por horas e atravessa a meia-noite: valor congelado no mount deixaria
// "hoje" parado em ontem e a coluna VAL pararia de avancar sem ninguem perceber.
checa('o helper NAO e memoizado com lista de dependencias vazia',
  !/const hojeLocal = useMemo/.test(grade))
const iniMax = grade.indexOf('const maxValidDay = useMemo')
const maxValid = grade.slice(iniMax, iniMax + 700)
checa('maxValidDay tambem usa o fuso configurado',
  /hojeNoFusoDoSistema\(\)/.test(maxValid) && !/today\.getDate\(\)/.test(maxValid))

checa('a coluna CH explica o teto em tooltip', /const chTooltip = limitou/.test(grade))
checa('o tooltip do total decompoe as parcelas', /const composicao = \[/.test(grade))
checa('a decomposicao cita as horas de plantao fora das unidades PL',
  /totals\.p_plAvulso > 0 \?/.test(grade))
checa('a decomposicao marca o sobreaviso como fora do total de horas',
  /fora do total de horas/.test(grade))

console.log('')
console.log(ok + ' asserções OK, ' + falhas + ' falha(s)')
if (falhas > 0) { console.log('PORTAO REPROVOU'); process.exit(1) }
console.log('PORTAO OK')
