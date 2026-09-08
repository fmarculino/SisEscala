// Gera a migration que impede o BLOCO de atravessar unidades.
//
// Copia mecanica de fn_confirmar_presenca e fn_blocos_previstos_dia a partir da migration
// VIGENTE das duas (20260903100000). Nao redigitar corpo de funcao a mao (armadilha 1):
// este script aborta se qualquer contagem de ocorrencia divergir do esperado.
//
// As substituicoes usam split().join(), NUNCA String.replace com string: replace interpreta
// os padroes de cifrao ($$ vira $, e $' vira o resto do arquivo), o que ja quebrou o
// dollar-quoting do plpgsql uma vez (20260809000000).
const fs = require('fs')

const FONTE = 'supabase/migrations/20260903100000_ancora_do_plantao_que_nao_colide_com_o_regular.sql'
const SAIDA = 'supabase/migrations/20260908140000_bloco_nao_atravessa_unidade.sql'
const CRLF = '\r\n'

const src = fs.readFileSync(FONTE, 'utf8')
if (!src.includes(CRLF)) {
  console.error('ABORTADO: a fonte nao esta em CRLF; as substituicoes assumem CRLF.')
  process.exit(1)
}

function fatia(inicioTexto, fimTexto, rotulo) {
  const i = src.indexOf(inicioTexto)
  if (i < 0) { console.error(`ABORTADO: nao achei o inicio de ${rotulo}`); process.exit(1) }
  const j = src.indexOf(fimTexto, i)
  if (j < 0) { console.error(`ABORTADO: nao achei o fim de ${rotulo}`); process.exit(1) }
  return src.slice(i, j + fimTexto.length)
}

const FIM_PLPGSQL = '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;'
const fnConfirmar = fatia('CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(', FIM_PLPGSQL, 'fn_confirmar_presenca')
const fnBlocos = fatia('CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia(', CRLF + '$fnbloco$;', 'fn_blocos_previstos_dia')

// Cada extrato tem de conter UMA funcao so: se o marcador de fim mudar, a fatia engole a
// funcao seguinte e a migration sairia recriando algo que ninguem pediu.
for (const [rot, txt] of [['fn_confirmar_presenca', fnConfirmar], ['fn_blocos_previstos_dia', fnBlocos]]) {
  const n = txt.split('CREATE OR REPLACE FUNCTION').length - 1
  if (n !== 1) { console.error(`ABORTADO: extrato de ${rot} tem ${n} CREATE, esperado 1`); process.exit(1) }
}

// [de, para, ocorrencias esperadas]
const SUBS = [
  // 1. DECLARACOES. A variavel tem de existir nos DOIS blocos DECLARE (o de
  //    fn_confirmar_presenca e o de fn_blocos_previstos_dia): variavel desconhecida e o unico
  //    erro que o Postgres pega no CREATE, e ele recusaria a funcao inteira (20260823130000).
  ['v_s1_dobra_diurna BOOLEAN;', 'v_s1_dobra_diurna BOOLEAN; v_s1_unidade UUID;', 2],
  ['v_s2_dobra_diurna BOOLEAN;', 'v_s2_dobra_diurna BOOLEAN; v_s2_unidade UUID;', 2],
  ['v_s3_dobra_diurna BOOLEAN;', 'v_s3_dobra_diurna BOOLEAN; v_s3_unidade UUID; v_b1_unidade UUID;', 2],

  // 2. O cursor passa a trazer a unidade da escala daquele turno. Os tres cursores ja fazem
  //    JOIN com escala_mensal em; o alias novo evita colidir com v_unidade_id da funcao.
  ['ed.id as escala_diaria_id, ',
    'ed.id as escala_diaria_id, ' + CRLF + '            em.unidade_id as escala_unidade_id, ', 3],

  // 3. Atribuicao, na mesma linha em que cada turno lido vira v_s1/v_s2/v_s3.
  ['v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false);',
    'v_s1_dobra_diurna := COALESCE(r.dobra_diurna, false); v_s1_unidade := r.escala_unidade_id;', 3],
  ['v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false);',
    'v_s2_dobra_diurna := COALESCE(r.dobra_diurna, false); v_s2_unidade := r.escala_unidade_id;', 3],
  ['v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false);',
    'v_s3_dobra_diurna := COALESCE(r.dobra_diurna, false); v_s3_unidade := r.escala_unidade_id;', 3],

  // 4. O bloco 1 nasce sempre do primeiro turno, em todos os ramos de montagem — entao a
  //    unidade dele e a de v_s1 em todos eles.
  ['v_b1_inicio := v_s1_inicio;', 'v_b1_unidade := v_s1_unidade; v_b1_inicio := v_s1_inicio;', 15],

  // 5. AS TRES CONDICOES DE FUSAO. Fundir turnos de unidades diferentes diz que a pessoa fez
  //    um turno continuo atravessando dois lugares: cria uma fronteira interna onde as batidas
  //    de um relogio e do outro se trocam, e apaga o intervalo do segundo turno (armadilha 6,
  //    o bloco carrega UM intervalo so).
  //    IS NOT DISTINCT FROM, e nao =: unidade nula dos dois lados nao pode virar NULL e deixar
  //    a condicao inteira indefinida, o que na pratica proibiria toda fusao.
  ['AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna THEN',
    'AND NOT v_s1_dobra_diurna AND NOT v_s2_dobra_diurna' + CRLF +
    '               AND v_s1_unidade IS NOT DISTINCT FROM v_s2_unidade THEN', 6],
  ["v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna THEN",
    "v_s3_inicio <= v_b1_fim AND v_s3_cat <> 'Sobreaviso' AND NOT v_s3_dobra_diurna" + CRLF +
    '                   AND v_s3_unidade IS NOT DISTINCT FROM v_b1_unidade THEN', 3],
  ['AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna THEN',
    'AND NOT v_s2_dobra_diurna AND NOT v_s3_dobra_diurna' + CRLF +
    '                   AND v_s2_unidade IS NOT DISTINCT FROM v_s3_unidade THEN', 3],
]

let out = fnConfirmar + CRLF + CRLF + CRLF + fnBlocos + CRLF + '$fnbloco$;'
// a fatia de fn_blocos_previstos_dia ja termina no marcador; nao duplicar
out = fnConfirmar + CRLF + CRLF + CRLF + fnBlocos

let falhou = false
for (const [de, para, esperado] of SUBS) {
  const n = out.split(de).length - 1
  const ok = n === esperado
  if (!ok) falhou = true
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${String(n).padStart(3)}/${String(esperado).padEnd(3)} ${de.slice(0, 68)}`)
  out = out.split(de).join(para)
}
if (falhou) { console.error('\nABORTADO: contagem divergente. Nao gerei nada.'); process.exit(1) }

// --- invariantes estruturais do resultado ---
const INVARIANTES = [
  ['CREATE OR REPLACE FUNCTION', 2, 'exatamente as duas funcoes'],
  ['$fnbloco$', 2, 'dollar-quoting de fn_blocos_previstos_dia em par'],
  ['$$', 2, 'dollar-quoting de fn_confirmar_presenca em par'],
]
for (const [p, esperado, rot] of INVARIANTES) {
  const n = out.split(p).length - 1
  if (n !== esperado) { console.error(`ABORTADO: ${rot}: "${p}" aparece ${n}x, esperado ${esperado}`); process.exit(1) }
  console.log(`ok   invariante: ${rot} (${n})`)
}

// Guards que a copia NAO pode ter perdido (armadilha 1: CREATE OR REPLACE ja apagou logica
// critica seis vezes, e nada disso quebra tsc/lint/build).
const GUARDS = [
  "v_s1_cat <> 'Sobreaviso'",
  "AND ed.categoria IN ('Regular', 'Plantão', 'Extra', 'Sobreaviso')",
  'fn_ancora_plantao_livre_do_regular',
  'fn_intervalo_previsto_minutos',
  'fn_jornada_tem_intervalo',
  'fn_ajuste_intervalo_flexivel',
  'turnos_inicio',
  'obter_jornada_servidor_data',
]
for (const g of GUARDS) {
  const n = out.split(g).length - 1
  if (n === 0) { console.error(`ABORTADO: guard ausente no resultado: ${g}`); process.exit(1) }
  console.log(`ok   guard presente (${String(n).padStart(2)}x): ${g}`)
}

// A unidade so pode entrar na FUSAO. Se aparecer no cursor de escopo ou num filtro de linha,
// alguem transformou "nao funde" em "nao enxerga" — que e outra coisa, e quebraria a montagem
// de blocos de quem tem duas escalas no dia.
const PROIBIDO = ['AND em.unidade_id =', 'AND em.unidade_id IN']
for (const p of PROIBIDO) {
  if (out.includes(p)) { console.error(`ABORTADO: o resultado filtra a consulta por unidade ("${p}"), e a regra e so de fusao.`); process.exit(1) }
  console.log(`ok   nao filtra a consulta por unidade: ${p}`)
}

const cab = fs.readFileSync('scratchpad/cab_bloco_unidade.txt', 'utf8')
const rod = fs.readFileSync('scratchpad/rod_bloco_unidade.txt', 'utf8')
fs.writeFileSync(SAIDA, cab + out + CRLF + rod)
console.log(`\ngerado: ${SAIDA} (${fs.statSync(SAIDA).size} bytes)`)
