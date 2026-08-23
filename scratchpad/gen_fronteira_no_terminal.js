/**
 * Gera supabase/migrations/20260823130000_batida_de_transicao_no_terminal.sql
 *
 * Leva os slots de FRONTEIRA para fn_confirmar_presenca — o terminal. A 20260819200000 os deu a
 * fn_blocos_previstos_dia / fn_alocar_marcacoes_dia / fn_projecao_marcacoes_dia e NAO ao terminal,
 * entao quem bate na transicao entre dois turnos fundidos leva "Fora da janela de presenca
 * permitida", vira marcacao pendente, e para de bater (AGNA, mat. 205: 13 recusas em 08/2026, e
 * nos dias 5, 6 e 7 nenhuma saida).
 *
 * ⚠️ ARMADILHA 1 DO CLAUDE.md: seis regressoes ja sairam de recopiar esta funcao a mao, cinco
 * delas da mesma migration. Nada e redigitado: o corpo vigente e copiado e as substituicoes sao
 * pontuais, com contagem de ocorrencias. O script ABORTA em qualquer divergencia.
 *
 * Uso: node scratchpad/gen_fronteira_no_terminal.js
 */
const fs = require('fs'), path = require('path')

const MIG = path.join(__dirname, '..', 'supabase', 'migrations')
const SRC = path.join(MIG, '20260822130000_plantao_interval_presence_functions.sql')
const OUT = path.join(MIG, '20260823130000_batida_de_transicao_no_terminal.sql')

const die = m => { console.error('ABORTADO: ' + m); process.exit(1) }
const conta = (s, sub) => s.split(sub).length - 1
function troca(s, de, para, n, rot) {
  const c = conta(s, de)
  if (c !== n) die(rot + ' — esperava ' + n + ', achei ' + c)
  return s.split(de).join(para)
}

const src = fs.readFileSync(SRC, 'utf8')
const NL = src.includes('\r\n') ? '\r\n' : '\n'
const nl = t => t.split('\n').join(NL)

// ------------------------------------------------------------------ recorte
const INI = 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca('
const FIM = 'CREATE OR REPLACE FUNCTION public.fn_blocos_previstos_dia('
const a = src.indexOf(INI), b = src.indexOf(FIM)
if (a < 0 || b < 0) die('nao achei os limites de fn_confirmar_presenca')
let fn = src.slice(a, b).replace(/\s+$/, '') + NL

// invariantes que precisam SOBREVIVER (armadilha 1: conferidos antes e depois)
const INVARIANTES = [
  ["AND ed.categoria IN ('Regular', 'Plantão', 'Extra')", 2],   // Sobreaviso fora dos blocos
  ['fn_ajuste_intervalo_flexivel', 3],                          // intervalo flexivel
  ['fn_intervalo_previsto_minutos', 10],                         // intervalo do plantao (22/08)
  ['fn_salvar_saida_bloco', 2],
  ['fn_log_tentativa_negada', 5],
  ["'Matrícula ou PIN inválidos.'", 2],
  ['dobra_diurna', 31],                                          // guard de nao-fusao (09/08)
  ["v_b_saidas[v_b_total_count] IS NULL", 3],
]
for (const [sub, n] of INVARIANTES) {
  const c = conta(fn, sub)
  if (c !== n) die('invariante ANTES fora de conta: ' + JSON.stringify(sub.slice(0, 48)) + ' esperava ' + n + ', achei ' + c)
}

// ------------------------------------------------- 1. declaracoes dos blocos
const DECL_RE = /(v_b(\d)_ids UUID\[\];)/g
const nDecl = (fn.match(DECL_RE) || []).length
if (nDecl !== 3) die('esperava 3 declaracoes v_bN_ids, achei ' + nDecl)
fn = fn.replace(DECL_RE, (_, todo, n) =>
  todo + ' v_b' + n + '_turnos_ini INTEGER[]; v_b' + n + '_turnos_fim INTEGER[];')

// --------------------------------------- 2. atribuicoes: deriva os previstos
// `v_bN_ids := ARRAY[v_s1_id, v_s2_id];` -> acrescenta turnos_ini/turnos_fim com a MESMA lista.
// E derivacao mecanica: nao ha o que redigitar, logo nao ha o que errar.
const ATRIB_RE = /v_b(\d)_ids := ARRAY\[([^\]]+)\];/g
const nAtrib = (fn.match(ATRIB_RE) || []).length
if (nAtrib !== 22) die('esperava 22 atribuicoes v_bN_ids, achei ' + nAtrib)
fn = fn.replace(ATRIB_RE, (todo, n, lista) => {
  const partes = lista.split(',').map(x => x.trim())
  for (const p of partes) if (!/^v_s\d_id$/.test(p)) die('lista de ids inesperada: ' + lista)
  const ini = partes.map(p => p.replace('_id', '_inicio')).join(', ')
  const fim = partes.map(p => p.replace('_id', '_fim')).join(', ')
  return todo + ' v_b' + n + '_turnos_ini := ARRAY[' + ini + ']; v_b' + n + '_turnos_fim := ARRAY[' + fim + '];'
})

// ------------------------------- 3. copia para as variaveis de trabalho v_b_*
const COPIA_RE = /v_b_ids := v_b(\d)_ids;/g
const nCopia = (fn.match(COPIA_RE) || []).length
if (nCopia !== 9) die('esperava 9 copias v_b_ids := v_bN_ids, achei ' + nCopia)
fn = fn.replace(COPIA_RE, (todo, n) =>
  todo + ' v_b_turnos_ini := v_b' + n + '_turnos_ini; v_b_turnos_fim := v_b' + n + '_turnos_fim;')

// ------------------------- 4. declara as variaveis de trabalho e o alvo da fronteira
// ⚠️ `v_b_total_count INTEGER;` aparece nos DOIS blocos DECLARE (cursor de ontem e cursor de
// hoje). Ancorar nele pegaria os dois. `v_transicao` so existe no laco de HOJE, que e onde a
// fronteira precisa viver.
fn = troca(fn,
  '        v_transicao BOOLEAN := false;',
  '        v_transicao BOOLEAN := false;' + NL +
  '        -- Previsto de cada turno fundido no bloco corrente, na ordem de v_b_ids. E o que' + NL +
  '        -- permite achar a FRONTEIRA: turnos_fim[i] = turnos_ini[i+1].' + NL +
  '        v_b_turnos_ini INTEGER[]; v_b_turnos_fim INTEGER[];' + NL +
  '        f INTEGER;' + NL +
  '        v_fronteira_min INTEGER;',
  1, 'declaracao das variaveis de trabalho')

// ------------------------------------------- 5. os passos de fronteira no laco
fn = troca(fn,
  nl(`            -- Step 2: Interval Exit (Saída Almoço)`),
  nl(`            -- Step 1.b: BATIDA DE TRANSICAO ENTRE TURNOS FUNDIDOS (20260823130000)
            --
            -- Um bloco pode fundir ate 3 turnos (armadilha 6). Na fronteira entre dois deles a
            -- pessoa fecha um turno e abre o seguinte — e ate aqui o terminal so conhecia os 4
            -- passos do BLOCO, entao essa batida caia em "Fora da janela de presenca permitida".
            -- A reconciliacao ja sabia disso desde a 20260819200000; o terminal, nao. O servidor
            -- via recusa e parava de bater (AGNA, mat. 205, dias 5, 6 e 7 de 08/2026: nenhuma
            -- saida registrada).
            --
            -- ⚠️ POR QUE AQUI, ENTRE O CHECKIN E O INTERVALO
            --   Depois do checkin porque nao se fecha um turno que ainda nao foi aberto. ANTES do
            --   intervalo porque em unidade de intervalo FLEXIVEL o passo 2 aceita "qualquer
            --   momento apos a entrada" — ele engoliria a batida de transicao e a gravaria como
            --   saida para o almoco. Foi o que aconteceu com MAISA (mat. 32269) em 18/08/2026.
            --
            -- ⚠️ O DESEMPATE CONTRA O INTERVALO E POR PROXIMIDADE, nao por ordem.
            --   Sem ele, um bloco cujo intervalo previsto cai perto da fronteira teria a batida
            --   do almoco classificada como transicao. A alocacao (fn_alocar_marcacoes_dia) casa
            --   por menor distancia; aqui vale o mesmo criterio, senao terminal e reconciliacao
            --   discordam sobre a mesma batida.
            --
            -- Nada e fabricado: sem batida na fronteira nao ha passo nenhum, exatamente como
            -- antes. Este bloco so ACEITA uma batida que hoje e recusada.
            IF v_b_total_count > 1 AND array_length(v_b_turnos_fim, 1) = v_b_total_count THEN
                FOR f IN 1..(v_b_total_count - 1) LOOP
                    v_fronteira_min := v_b_turnos_fim[f];

                    IF (v_b_int_ini IS NULL OR
                        abs(v_momento_atual_minutos - v_fronteira_min) <= abs(v_momento_atual_minutos - v_b_int_ini))
                       AND (v_b_int_fim IS NULL OR
                        abs(v_momento_atual_minutos - v_fronteira_min) <= abs(v_momento_atual_minutos - v_b_int_fim))
                       AND v_momento_atual_minutos >= (v_fronteira_min - v_janela_minutos)
                       AND v_momento_atual_minutos <= (v_fronteira_min + v_janela_minutos)
                    THEN
                        -- Fecha o turno que termina na fronteira.
                        IF v_b_saidas[f] IS NULL THEN
                            v_matched_action := 'fronteira_saida';
                            v_matched_ids := ARRAY[v_b_ids[f]];
                            v_matched_cat := v_b_cat;
                            EXIT;
                        END IF;
                        -- Ja fechado: a mesma janela abre o turno seguinte. Duas batidas na
                        -- fronteira preenchem os dois lados; uma so preenche o primeiro e a
                        -- reconciliacao espelha para o outro (20260823100000).
                        IF v_b_entradas[f + 1] IS NULL THEN
                            v_matched_action := 'fronteira_entrada';
                            v_matched_ids := ARRAY[v_b_ids[f + 1]];
                            v_matched_cat := v_b_cat;
                            EXIT;
                        END IF;
                    END IF;
                END LOOP;
                EXIT WHEN v_matched_action IS NOT NULL;
            END IF;

            -- Step 2: Interval Exit (Saída Almoço)`),
  1, 'passos de fronteira')

// --------------------------------------------- 6. processamento das acoes novas
fn = troca(fn,
  nl(`        -- Process the matched action
        IF v_matched_action = 'checkin' THEN`),
  nl(`        -- Process the matched action

        -- BATIDA DE TRANSICAO (20260823130000). Grava na LINHA daquele turno, nunca no bloco
        -- inteiro: e essa especificidade que faz a folha e o anexo de plantoes saberem onde o
        -- expediente terminou e onde o plantao comecou.
        IF v_matched_action IN ('fronteira_saida', 'fronteira_entrada') THEN
            -- Só UPDATE em escala_diaria, como todos os outros passos: quem grava em
            -- marcacoes_ponto é fn_registrar_ponto, o wrapper que chama esta função.
            IF v_matched_action = 'fronteira_saida' THEN
                UPDATE public.escala_diaria
                SET presenca_saida_em = v_now, confirmado_por_id = p_coordenador_id
                WHERE id = v_matched_ids[1];
            ELSE
                UPDATE public.escala_diaria
                SET presenca_entrada_em = v_now, presenca_confirmada = true, confirmado_por_id = p_coordenador_id
                WHERE id = v_matched_ids[1];
            END IF;

            RETURN jsonb_build_object('success', true, 'message',
                CASE WHEN v_matched_action = 'fronteira_saida'
                     THEN 'Saída do turno confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Registre a entrada do próximo turno.'
                     ELSE 'Entrada do próximo turno confirmada às ' || to_char(v_now_local, 'HH24:MI') || '. Bom trabalho!'
                END);
        END IF;

        IF v_matched_action = 'checkin' THEN`),
  1, 'processamento da fronteira')

for (const [sub, n] of INVARIANTES) {
  const c = conta(fn, sub)
  if (c !== n) die('invariante DEPOIS fora de conta: ' + JSON.stringify(sub.slice(0, 48)) + ' esperava ' + n + ', achei ' + c)
}

// ------------------------------------------------------------ cabecalho + saida
const CAB = nl(`-- ============================================================================
-- Migration: a batida de transicao passa a ser ACEITA pelo terminal
-- Data: 2026-08-23
--
-- PROBLEMA
--   A 20260819200000 deu slots de FRONTEIRA a fn_blocos_previstos_dia, fn_alocar_marcacoes_dia e
--   fn_projecao_marcacoes_dia — a reconciliacao. NAO deu a fn_confirmar_presenca, o terminal.
--   Resultado: quem bate na transicao entre dois turnos fundidos recebe "Fora da janela de
--   presenca permitida". A batida nao se perde (vira marcacao pendente e a reconciliacao a
--   aproveita), mas o SERVIDOR ve recusa — e para de bater.
--
--   AGNA CRISTINA RIBEIRO DO ROSARIO (mat. 205, LACEM), 08/2026: 13 tentativas recusadas, e nos
--   dias 5, 6 e 7 ela desistiu — a folha ficou com "REVISAR: SEM REGISTRO DE SAIDA".
--
--   Desde a 20260823100000 o dano financeiro acabou (o passo do bloco pertence a um turno so),
--   mas o custo virou trabalho manual: sem a batida de transicao, a saida do expediente fica
--   vazia e vira pendencia para o coordenador, dia apos dia. Esta migration remove esse custo.
--
-- CORRECAO
--   O bloco passa a carregar o previsto de CADA turno fundido (v_bN_turnos_ini/turnos_fim, os
--   mesmos que fn_blocos_previstos_dia ja expunha), e o laco de avaliacao ganha o passo 1.b:
--   na janela da fronteira, fecha o turno que termina ali; se ja fechado, abre o seguinte.
--
--   Grava na LINHA daquele turno, nunca no bloco inteiro.
--
-- POSICAO NO LACO — entre o checkin e o intervalo, e o desempate contra o intervalo e por
--   PROXIMIDADE. Em unidade de intervalo flexivel o passo 2 aceita "qualquer momento apos a
--   entrada" e engoliria a transicao, gravando-a como saida para o almoco (MAISA, mat. 32269,
--   18/08/2026). Sem o desempate, o inverso aconteceria num bloco cujo intervalo previsto caia
--   perto da fronteira. A alocacao casa por menor distancia; aqui vale o mesmo criterio, senao
--   terminal e reconciliacao discordam sobre a mesma batida.
--
-- O QUE NAO MUDA
--   - Bloco de UM turno so: nao existe fronteira, nada muda.
--   - Ninguem bate na transicao: nao ha passo nenhum, exatamente como antes. Este bloco so
--     ACEITA uma batida que hoje e recusada — nao fabrica nem exige nada.
--   - Uma batida so na fronteira continua bastando: ela fecha o turno, e a reconciliacao espelha
--     para a entrada do seguinte (20260823100000).
--   - Sobreaviso fora dos blocos, guard de nao-fusao do plantao diurno, intervalo do plantao,
--     intervalo flexivel e o cursor de ontem: todos intactos (conferidos por contagem).
--
-- ⚠️ ARMADILHA 1 DO CLAUDE.md: seis regressoes ja sairam de recopiar fn_confirmar_presenca a
--   mao, cinco da mesma migration. Nada aqui foi redigitado — corpo copiado da 20260822130000
--   por scratchpad/gen_fronteira_no_terminal.js, que deriva os arrays de turnos da propria lista
--   de ids e aborta se qualquer contagem divergir.
--
-- Plano: docs/planos/2026-08-23-turno-regular-emendado-com-plantao.md (item C3)
-- ============================================================================


`)

const CONF = nl(`

-- ============================================================================
-- CONFERENCIA (nao escreve)
-- ============================================================================
--
-- 1) O bloco da AGNA no dia 10 tem dois turnos e a fronteira as 14:00:
--
--    SELECT bloco_ordem, categoria, turnos_inicio, turnos_fim
--      FROM public.servidores s,
--           LATERAL public.fn_blocos_previstos_dia(s.id, DATE '2026-08-10')
--     WHERE s.matricula = '205';
--
-- 2) Bater na transicao deixa de ser recusado. Nao ha como simular sem escrever, entao o teste
--    e de campo: no terminal, num dia de Regular emendado com Plantao, bater no horario da
--    fronteira deve responder "Saída do turno confirmada às HH:MM. Registre a entrada do
--    próximo turno." — e a segunda batida, "Entrada do próximo turno confirmada".
--
-- 3) Nenhuma recusa nova. Comparar, na semana seguinte:
--
--    SELECT mensagem_erro, count(*)
--      FROM public.logs_tentativas_presenca
--     WHERE data_hora_tentativa >= now() - interval '7 days'
--     GROUP BY 1 ORDER BY 2 DESC;
--
--    "Fora da janela de presenca permitida" deve CAIR em unidades com turnos fundidos.
--
-- 4) A projecao continua concordando com o gravado (portao da 20260823100000):
--    node scratchpad/portao_dono_do_passo.js
-- ============================================================================
`)

const saida = CAB + fn + CONF

// conferencia estrutural do arquivo inteiro (licao do gen_dobra.js)
const dolar = (saida.match(/\$fn_confirmar_presenca\$|\$\$/g) || []).length
if (conta(saida, 'CREATE OR REPLACE FUNCTION public.fn_confirmar_presenca(') !== 1) die('CREATE fora de conta')
// Nao ha GRANT aqui de proposito: CREATE OR REPLACE preserva os privilegios existentes, e a
// 20260822130000 (a origem deste corpo) tambem nao traz um. O que precisa sobreviver e o
// terminador com SECURITY DEFINER — sem ele a funcao perde o dono e a RLS a barra.
if (conta(saida, '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;') !== 1) die('terminador SECURITY DEFINER ausente ou duplicado')
if (dolar % 2 !== 0) die('delimitadores de dollar-quoting impares: ' + dolar)
if (/\n(?!\r)/.test(saida.replace(/\r\n/g, ''))) die('sobrou LF solto — as migrations usam CRLF')

fs.writeFileSync(OUT, saida, 'utf8')
console.log('gerado: ' + path.relative(path.join(__dirname, '..'), OUT))
console.log('  linhas: ' + saida.split(NL).length)
console.log('  3 declaracoes + 22 atribuicoes + 9 copias de bloco')
console.log('  1 passo de fronteira no laco + 1 ramo de processamento')
console.log('  ' + INVARIANTES.length + ' invariantes conferidos antes e depois')
