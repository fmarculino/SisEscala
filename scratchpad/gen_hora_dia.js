#!/usr/bin/env node
/*
 * Gerador da migration de hora por dia (Fase 2) - escala_diaria.hora_inicio_prevista.
 *
 * CLAUDE.md armadilha 1: as funcoes de presenca NAO podem ser redigitadas a mao.
 * Copia o corpo VIGENTE de cada funcao e aplica UMA substituicao pontual, abortando se
 * qualquer contagem divergir.
 *
 * Fonte vigente apos a Fase 1: TODAS as tres funcoes vivem em 20260808100000.
 *
 * Substituicao: insere o NIVEL 1 da cadeia como PRIMEIRO argumento do COALESCE externo de
 * start_hour. Vale para Plantao e Extra; Regular fica de fora (para Regular o nome da jornada
 * continua mandando, e mexer nisso afeta folha e compliance).
 */
const fs = require('fs')
const path = require('path')

const MIG = 'supabase/migrations'
const SRC = '20260808100000_anchor_plantao_start_hour.sql'
const OUT = path.join(MIG, '20260808110000_add_hora_inicio_prevista_escala_diaria.sql')

const die = m => { console.error('ABORTADO: ' + m); process.exit(1) }
const count = (s, needle) => s.split(needle).length - 1
const src = fs.readFileSync(path.join(MIG, SRC), 'utf8')

// ---------------------------------------------------------------- 1. extracao
function fatiar(ini, term) {
  const i = src.indexOf(ini); if (i < 0) die(`marcador nao encontrado: ${ini}`)
  const j = src.indexOf(term, i); if (j < 0) die(`terminador nao encontrado apos ${ini}`)
  return src.slice(i, j + term.length)
}
const TERM = '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;'
const fnTerminal = fatiar('CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(', TERM)
const fnManual = fatiar('CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(', TERM)
const fnBlocos = fatiar('CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(', '$fnbloco$;')

// ------------------------------------ 2. invariantes na ORIGEM (medidos em scratchpad/conta2.js)
const inv = [
  ['fn_confirmar_presenca', fnTerminal, {
    "<> 'Sobreaviso'": 14, 'fn_jornada_tem_intervalo': 2, 'fn_ajuste_intervalo_flexivel': 3,
    "CASE WHEN ed.categoria = 'Regular' THEN": 2, "CASE WHEN ed.categoria = 'Plantão' THEN": 2,
    "ed.categoria IN ('Regular', 'Plantão', 'Extra')": 2, 'ORDER BY start_hour ASC': 2,
    'extract(hour from dt.horario_inicio)::integer': 2,
    'fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL': 2,
  }],
  ['fn_confirmar_presenca_manual', fnManual, {
    "<> 'Sobreaviso'": 1, 'fn_jornada_tem_intervalo': 1,
    "CASE WHEN ed.categoria = 'Regular' THEN": 1, "CASE WHEN ed.categoria = 'Plantão' THEN": 1,
    'p_categoria::public.escala_categoria': 10, 'justificativa_manual': 7,
    'presenca_entrada_manual': 8, "p_categoria <> 'Sobreaviso'": 1,
    'extract(hour from dt.horario_inicio)::integer': 1,
  }],
  ['fn_blocos_previstos_dia', fnBlocos, {
    "<> 'Sobreaviso'": 7, 'fn_jornada_tem_intervalo': 1,
    "CASE WHEN ed.categoria = 'Regular' THEN": 1, "CASE WHEN ed.categoria = 'Plantão' THEN": 1,
    "ed.categoria IN ('Regular', 'Plantão', 'Extra')": 1, 'ORDER BY start_hour ASC': 1,
    'extract(hour from dt.horario_inicio)::integer': 1,
  }],
]
for (const [nome, corpo, esp] of inv) {
  for (const [n, q] of Object.entries(esp)) {
    const got = count(corpo, n)
    if (got !== q) die(`${nome}: esperava ${q} de ${JSON.stringify(n)}, achei ${got}`)
  }
  console.log(`  ok  ${nome}: ${Object.keys(esp).length} invariantes (${corpo.length} bytes)`)
}

// -------------------------------------------------------------- 3. substituicao
const ALVO = /(COALESCE\(\r?\n)(\s*)(CASE WHEN ed\.categoria = 'Regular' THEN)/g
const NIVEL1 = ind =>
  `${ind}-- NIVEL 1 da cadeia de precedencia de horario (o mais alto). Ver\n` +
  `${ind}-- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md\n` +
  `${ind}--\n` +
  `${ind}-- Hora que o COORDENADOR informou ao escalar. E o unico nivel capaz de resolver os\n` +
  `${ind}-- codigos em que o codigo do turno da a duracao e o periodo, mas nao a hora:\n` +
  `${ind}-- T4, N4, N6, M7 ("M2 sao 2h em qualquer ponto da manha").\n` +
  `${ind}--\n` +
  `${ind}-- NULL por padrao em toda linha existente, entao nao muda NADA ate alguem preencher.\n` +
  `${ind}--\n` +
  `${ind}-- NAO vale para Regular: la o nome da jornada continua mandando, e mexer nisso\n` +
  `${ind}-- afetaria folha de ponto e motor de compliance. NAO REMOVER ESTA CONDICAO.\n` +
  `${ind}CASE WHEN ed.categoria <> 'Regular'\n` +
  `${ind}     THEN extract(hour from ed.hora_inicio_prevista)::integer END,\n`

function aplicar(nome, corpo, esperadas) {
  let n = 0
  const novo = corpo.replace(ALVO, (m, abre, ind, resto) => { n++; return abre + NIVEL1(ind) + ind + resto })
  if (n !== esperadas) die(`${nome}: esperava ${esperadas} substituicao(oes), fiz ${n}`)
  console.log(`  ok  ${nome}: ${n} substituicao(oes), +${novo.length - corpo.length} bytes`)
  return novo
}
const outTerm = aplicar('fn_confirmar_presenca', fnTerminal, 2)
const outMan = aplicar('fn_confirmar_presenca_manual', fnManual, 1)
const outBlk = aplicar('fn_blocos_previstos_dia', fnBlocos, 1)

// ------------------------------------------- 4. reconferencia no RESULTADO
for (const [nome, corpo, esp] of [['fn_confirmar_presenca', outTerm, inv[0][2]], ['fn_confirmar_presenca_manual', outMan, inv[1][2]], ['fn_blocos_previstos_dia', outBlk, inv[2][2]]]) {
  for (const [n, q] of Object.entries(esp)) {
    const got = count(corpo, n)
    if (got !== q) die(`POS-SUBSTITUICAO ${nome}: ${JSON.stringify(n)} passou de ${q} para ${got}`)
  }
  const nNivel1 = count(corpo, 'extract(hour from ed.hora_inicio_prevista)::integer')
  const nGuard = count(corpo, "CASE WHEN ed.categoria <> 'Regular'")
  if (nNivel1 < 1) die(`${nome}: nivel 1 nao inserido`)
  if (nNivel1 !== nGuard) die(`${nome}: ${nNivel1} nivel-1 mas ${nGuard} guard(s) de "nao Regular"`)
  // o nivel 1 tem que vir ANTES do nivel 2 em cada ramo
  if (corpo.indexOf('ed.hora_inicio_prevista') > corpo.indexOf('dt.horario_inicio')) {
    die(`${nome}: nivel 1 aparece DEPOIS do nivel 2 - ordem de precedencia invertida`)
  }
  console.log(`  ok  ${nome}: invariantes preservados, nivel 1 precede nivel 2`)
}

// ---------------------------------------------------------------- 5. montagem
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8')
const corpoFinal = [
  R('cab2.sql'), R('ddl2.sql'),
  '\n\n-- ============================================================================\n-- 3. fn_confirmar_presenca (terminal) - copia de 20260808100000 + 2 insercoes\n-- ============================================================================\n\n', outTerm,
  '\n\n\n-- ============================================================================\n-- 4. fn_confirmar_presenca_manual - copia de 20260808100000 + 1 insercao\n-- ============================================================================\n\n', outMan,
  '\n\n\n-- ============================================================================\n-- 5. fn_blocos_previstos_dia - copia de 20260808100000 + 1 insercao\n-- ============================================================================\n\n', outBlk,
  '\n\n', R('rodape.sql'),
].join('')

fs.writeFileSync(OUT, corpoFinal.replace(/\r?\n/g, '\r\n'), 'utf8')
console.log(`\nGERADO: ${OUT}`)
for (const [n, a, d] of [['terminal', fnTerminal, outTerm], ['manual', fnManual, outMan], ['blocos', fnBlocos, outBlk]]) {
  fs.writeFileSync(path.join(__dirname, `d2_${n}_antes.sql`), a)
  fs.writeFileSync(path.join(__dirname, `d2_${n}_depois.sql`), d)
}
console.log('Arquivos de diff escritos em ' + __dirname)
