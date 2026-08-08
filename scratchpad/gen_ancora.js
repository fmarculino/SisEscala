#!/usr/bin/env node
/*
 * Gerador da migration de ancoragem de horario dos plantoes (Fase 1).
 *
 * CLAUDE.md armadilha 1: as funcoes de presenca NAO podem ser redigitadas a mao.
 * Este script copia o corpo VIGENTE de cada funcao e aplica UMA substituicao pontual,
 * abortando se qualquer contagem divergir do esperado.
 *
 * Fontes vigentes (conferidas com: grep -rln "FUNCTION public.fn_..." | sort | tail -1):
 *   fn_confirmar_presenca         <- 20260807050000 (linhas 84..1139)
 *   fn_confirmar_presenca_manual  <- 20260807100000 (arquivo inteiro, apos o cabecalho)
 *   fn_blocos_previstos_dia       <- 20260808040000 (arquivo inteiro, apos o cabecalho)
 *
 * Substituicao: insere `extract(hour from dt.horario_inicio)::integer` como PRIMEIRO
 * argumento do COALESCE do ramo `CASE WHEN ed.categoria = 'Plantao' THEN`. Como extract()
 * devolve NULL quando a coluna e NULL, todo codigo sem ancora cai na cascata atual sem
 * nenhuma mudanca de comportamento.
 *
 * O ramo `Regular` NAO e tocado: para Regular o nome da jornada continua mandando.
 */
const fs = require('fs')
const path = require('path')

const MIG = 'supabase/migrations'
const OUT = path.join(MIG, '20260808100000_anchor_plantao_start_hour.sql')

const die = m => { console.error('ABORTADO: ' + m); process.exit(1) }
const read = f => fs.readFileSync(path.join(MIG, f), 'utf8')
const count = (s, needle) => s.split(needle).length - 1

// ---------------------------------------------------------------- 1. extracao
const fSrcTerm = '20260807050000_support_flexible_interval_per_servidor.sql'
const fSrcMan = '20260807100000_restore_interval_marks_on_period_scopes.sql'
const fSrcBlk = '20260808040000_add_fn_blocos_previstos_dia.sql'

const srcTerm = read(fSrcTerm), srcMan = read(fSrcMan), srcBlk = read(fSrcBlk)

// fn_confirmar_presenca: do CREATE ate o PRIMEIRO terminador "$$ LANGUAGE plpgsql ..."
function fatiar(src, marcadorInicio, arquivo) {
  const i = src.indexOf(marcadorInicio)
  if (i < 0) die(`marcador de inicio nao encontrado em ${arquivo}: ${marcadorInicio}`)
  const term = '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;'
  const j = src.indexOf(term, i)
  if (j < 0) die(`terminador nao encontrado em ${arquivo}`)
  return src.slice(i, j + term.length)
}

const fnTerminal = fatiar(srcTerm, 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(', fSrcTerm)
const fnManual = fatiar(srcMan, 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca_manual(', fSrcMan)

// fn_blocos_previstos_dia termina com "$fnbloco$;" (dollar-quote proprio)
const iBlk = srcBlk.indexOf('CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(')
if (iBlk < 0) die('fn_blocos_previstos_dia nao encontrada')
const termBlk = '$fnbloco$;'
const jBlk = srcBlk.indexOf(termBlk, iBlk)
if (jBlk < 0) die('terminador $fnbloco$; nao encontrado')
const fnBlocos = srcBlk.slice(iBlk, jBlk + termBlk.length)

// ---------------------------------------------- 2. conferencia dos invariantes na ORIGEM
// Contagens medidas nos arquivos vigentes em 08/08/2026 (scratchpad/conta.js).
// Qualquer divergencia aborta: e o mecanismo que pegou a indentacao errada em 20260807080000.
const inv = [
  ['fn_confirmar_presenca', fnTerminal, { "<> 'Sobreaviso'": 14, 'fn_jornada_tem_intervalo': 2, "CASE WHEN ed.categoria = 'Plantão' THEN": 2, "CASE WHEN ed.categoria = 'Regular' THEN": 2, "ed.categoria IN ('Regular', 'Plantão', 'Extra')": 2, 'ORDER BY start_hour ASC': 2, 'fn_ajuste_intervalo_flexivel': 3 }],
  ['fn_confirmar_presenca_manual', fnManual, { "<> 'Sobreaviso'": 1, "CASE WHEN ed.categoria = 'Plantão' THEN": 1, "CASE WHEN ed.categoria = 'Regular' THEN": 1, 'fn_jornada_tem_intervalo': 1, 'p_categoria::public.escala_categoria': 10, 'justificativa_manual': 7, 'presenca_entrada_manual': 8, "p_categoria <> 'Sobreaviso'": 1 }],
  ['fn_blocos_previstos_dia', fnBlocos, { "<> 'Sobreaviso'": 7, 'fn_jornada_tem_intervalo': 1, "CASE WHEN ed.categoria = 'Plantão' THEN": 1, "CASE WHEN ed.categoria = 'Regular' THEN": 1, "ed.categoria IN ('Regular', 'Plantão', 'Extra')": 1, 'ORDER BY start_hour ASC': 1 }],
]
for (const [nome, corpo, esperado] of inv) {
  for (const [needle, n] of Object.entries(esperado)) {
    const got = count(corpo, needle)
    if (got !== n) die(`${nome}: esperava ${n} ocorrencia(s) de ${JSON.stringify(needle)}, achei ${got}`)
  }
  console.log(`  ok  ${nome}: ${Object.keys(esperado).length} invariantes conferidos (${corpo.length} bytes)`)
}

// -------------------------------------------------------------- 3. substituicao
// Insere a ancora como primeiro argumento do COALESCE do ramo Plantao.
// Regex tolerante a indentacao (CLAUDE.md: indentacao divergente ja quebrou um gerador).
const ALVO = /(CASE WHEN ed\.categoria = 'Plantão' THEN\r?\n(\s*)COALESCE\(\r?\n)/g
const ANCORA = (ind) => `${ind}    -- NIVEL 2 da cadeia de precedencia de horario. Ver\n` +
  `${ind}    -- docs/planos/2026-08-08-ancoragem-de-horario-dos-plantoes.md\n` +
  `${ind}    --\n` +
  `${ind}    -- Ancora fixa do codigo do turno (M, T, N, MT). Devolve NULL para os outros 60\n` +
  `${ind}    -- codigos, entao a cascata abaixo continua valendo sem nenhuma mudanca.\n` +
  `${ind}    --\n` +
  `${ind}    -- SO VALE QUANDO NAO HA TURNO REGULAR NO DIA. Havendo Regular, o plantao e\n` +
  `${ind}    -- sequencia do expediente e o alinhamento da cascata esta correto - forcar a\n` +
  `${ind}    -- ancora ali sobreporia o plantao ao turno Regular (medido em 49 dias reais de\n` +
  `${ind}    -- producao em 08/08/2026). NAO REMOVER ESTA CONDICAO.\n` +
  `${ind}    CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL\n` +
  `${ind}         THEN extract(hour from dt.horario_inicio)::integer END,\n`

function aplicar(nome, corpo, esperadas) {
  let n = 0
  const novo = corpo.replace(ALVO, (m, todo, ind) => { n++; return todo + ANCORA(ind) })
  if (n !== esperadas) die(`${nome}: esperava ${esperadas} substituicao(oes), fiz ${n}`)
  // confere que nada mais mudou alem do inserido (tolerancia = diferenca de indentacao)
  const dif = novo.length - corpo.length
  const esperadoDif = esperadas * ANCORA('                    ').length
  if (Math.abs(dif - esperadoDif) > esperadas * 80) die(`${nome}: delta de tamanho inesperado (${dif} vs ~${esperadoDif})`)
  console.log(`  ok  ${nome}: ${n} substituicao(oes), +${dif} bytes`)
  return novo
}

const outTerm = aplicar('fn_confirmar_presenca', fnTerminal, 2)
const outMan = aplicar('fn_confirmar_presenca_manual', fnManual, 1)
const outBlk = aplicar('fn_blocos_previstos_dia', fnBlocos, 1)

// ------------------------------------------- 4. reconferencia dos invariantes no RESULTADO
for (const [nome, corpo, esperado] of [['fn_confirmar_presenca', outTerm, inv[0][2]], ['fn_confirmar_presenca_manual', outMan, inv[1][2]], ['fn_blocos_previstos_dia', outBlk, inv[2][2]]]) {
  for (const [needle, n] of Object.entries(esperado)) {
    const got = count(corpo, needle)
    if (got !== n) die(`POS-SUBSTITUICAO ${nome}: ${JSON.stringify(needle)} passou de ${n} para ${got}`)
  }
  if (count(corpo, 'extract(hour from dt.horario_inicio)::integer') < 1) die(`${nome}: ancora nao inserida`)
  // a ancora TEM que estar guardada pela condicao de ausencia de turno Regular
  const nAnc = count(corpo, 'extract(hour from dt.horario_inicio)::integer')
  const nGuard = count(corpo, 'CASE WHEN public.fn_obter_horario_regular_dia(em.id, ed.dia) IS NULL')
  if (nAnc !== nGuard) die(`${nome}: ${nAnc} ancora(s) mas ${nGuard} guard(s) de "sem turno Regular"`)
  console.log(`  ok  ${nome}: invariantes preservados apos a substituicao`)
}

// ---------------------------------------------------------------- 5. montagem
const CAB = fs.readFileSync(path.join(__dirname, 'cabecalho.sql'), 'utf8')
const DDL = fs.readFileSync(path.join(__dirname, 'ddl.sql'), 'utf8')
const ROD = fs.readFileSync(path.join(__dirname, 'rodape.sql'), 'utf8')

const corpoFinal = [CAB, DDL,
  '\n\n-- ============================================================================\n-- 3. fn_confirmar_presenca (terminal) - copia de 20260807050000 + 2 insercoes\n-- ============================================================================\n\n',
  outTerm,
  '\n\n\n-- ============================================================================\n-- 4. fn_confirmar_presenca_manual - copia de 20260807100000 + 1 insercao\n-- ============================================================================\n\n',
  outMan,
  '\n\n\n-- ============================================================================\n-- 5. fn_blocos_previstos_dia - copia de 20260808040000 + 1 insercao\n-- ============================================================================\n\n',
  outBlk,
  '\n\n', ROD,
].join('')

// arquivos de migration usam CRLF (CLAUDE.md, convencoes)
const crlf = corpoFinal.replace(/\r?\n/g, '\r\n')
fs.writeFileSync(OUT, crlf, 'utf8')
console.log(`\nGERADO: ${OUT}  (${crlf.length} bytes, CRLF)`)

// diff de conferencia
const dir = __dirname
fs.writeFileSync(path.join(dir, 'diff_terminal_antes.sql'), fnTerminal)
fs.writeFileSync(path.join(dir, 'diff_terminal_depois.sql'), outTerm)
fs.writeFileSync(path.join(dir, 'diff_manual_antes.sql'), fnManual)
fs.writeFileSync(path.join(dir, 'diff_manual_depois.sql'), outMan)
fs.writeFileSync(path.join(dir, 'diff_blocos_antes.sql'), fnBlocos)
fs.writeFileSync(path.join(dir, 'diff_blocos_depois.sql'), outBlk)
console.log('Arquivos de diff escritos em ' + dir)
