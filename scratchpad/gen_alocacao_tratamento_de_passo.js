/**
 * Gera 20260917120000_alocacao_honra_tratamento_de_passo.sql a partir da versao VIGENTE de
 * fn_alocar_marcacoes_dia, acrescentando TRES trechos e nao alterando mais nada:
 *
 *   1. declaracoes das variaveis novas;
 *   2. o bloco "2.c FIXACAO POR TRATAMENTO", entre o DP e o espelho de fronteira;
 *   3. o filtro que tira das pendencias a marcacao que acabou de ser fixada.
 *
 * ⚠️ O DP NAO E TOCADO. A fixacao age DEPOIS dele, por cima do vetor de vencedores: quem nao tem
 * tratamento ve exatamente o alinhamento de hoje. Mexer no custo/tolerancia do DP ja foi
 * simulado e descartado em 19/08/2026 (corrige 2 e quebra 3 dias saudaveis).
 *
 * Copia mecanica (CLAUDE.md armadilha 1) com EOL detectado da fonte (armadilha 59) e
 * invariantes conferidos antes e depois.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const SAIDA = path.join(DIR, '20260917120000_alocacao_honra_tratamento_de_passo.sql')

const abortar = (m) => { console.error('ABORTADO: ' + m); process.exit(1) }

// ---------------------------------------------------------------------------
// 1. Qual migration define a versao VIGENTE? (nunca a que o nome sugere)
// ---------------------------------------------------------------------------
const definem = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.sql') && f !== path.basename(SAIDA))
  .filter(f => fs.readFileSync(path.join(DIR, f), 'utf8')
    .includes('CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia'))
  .sort()
if (definem.length === 0) abortar('nenhuma migration define fn_alocar_marcacoes_dia')
const vigente = definem[definem.length - 1]
console.log('fonte vigente: ' + vigente)

const bruto = fs.readFileSync(path.join(DIR, vigente), 'utf8')
const EOL = bruto.includes('\r\n') ? '\r\n' : '\n'
console.log('EOL da fonte: ' + (EOL === '\r\n' ? 'CRLF' : 'LF'))

const INI = 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia('
const FIM = '$fnaloc$;'
const iIni = bruto.indexOf(INI)
const iFim = bruto.indexOf(FIM, iIni)
if (iIni < 0 || iFim < 0) abortar('nao achei os delimitadores da funcao')
let corpo = bruto.slice(iIni, iFim + FIM.length)

// ---------------------------------------------------------------------------
// 2. Invariantes ANTES: a fonte e a que este gerador sabe editar?
// ---------------------------------------------------------------------------
const INVARIANTES_FONTE = [
  ['teto de alocacao de 720 min', 'c_teto_alocacao_min constant integer := 720'],
  ['regra do dono (sombras)', 'v_sombra_prev'],
  ['restricao de lugar por dispositivo', 'fn_dispositivo_atende_setor'],
  ['predicado inline de desconsiderar', "AND t.tipo = 'desconsiderar'"],
  ['espelho da fronteira', '2.b ESPELHO DA BATIDA DE TRANSICAO SOLITARIA'],
  ['reordenacao dos slots com unidade', 'INTO v_slot_passo, v_slot_prev, v_slot_bloco, v_slot_ids, v_slot_data, v_slot_piso, v_slot_opcional, v_slot_unidade, v_slot_setor'],
]
for (const [nome, marca] of INVARIANTES_FONTE) {
  if (!corpo.includes(marca)) abortar(`a fonte nao contem o invariante "${nome}" -- ela mudou, reveja o gerador`)
}

// O DP e o que NAO pode mudar. A contagem e MEDIDA na fonte, nunca fixada no gerador: numero
// cravado aqui envelhece na primeira vez que a alocacao for reescrita por outro motivo, e o
// gerador passaria a abortar por uma diferenca que nao e a que ele quer vigiar.
const CUSTO = /v_tol_ontem \* 2/g
const custoAntes = (corpo.match(CUSTO) || []).length
if (custoAntes === 0) abortar('nao achei o custo de nao-casar do DP na fonte')
console.log(`custo de nao-casar na fonte: ${custoAntes} ocorrencia(s)`)

// ---------------------------------------------------------------------------
// 3. Declaracoes novas
// ---------------------------------------------------------------------------
// ⚠️ Variavel nao declarada e o UNICO erro de plpgsql que o Postgres pega no CREATE
// (42601), e nao na execucao. Aqui ha um DECLARE so -- ao contrario de fn_confirmar_presenca,
// que tem dois (cursor de ontem e de hoje) e ja recusou uma migration por isso.
const ANCORA_DECL = '    r               record;'
if (corpo.split(ANCORA_DECL).length - 1 !== 1) abortar('ancora das declaracoes nao encontrada uma unica vez')
const decls = [
  '    -- ---- FIXACAO POR TRATAMENTO (20260917120000) --------------------------',
  '    -- Linhas de escala_diaria que os slots deste dia nomeiam. E o recorte da busca por',
  '    -- tratamento: so interessa o juizo do coordenador sobre as linhas que estao em jogo.',
  '    v_linhas        uuid[]        := \'{}\';',
  '    -- Marcacoes fixadas nesta execucao. Elas saem das pendencias no fim: uma batida nao pode',
  '    -- aparecer alocada E pendente na mesma resposta.',
  '    v_fixadas       uuid[]        := \'{}\';',
  '    v_alvo_slot     integer;',
  '    v_dist_fix      numeric;',
  '    rt              record;',
  '    s_fix           integer;',
  ANCORA_DECL,
].join(EOL)
corpo = corpo.replace(ANCORA_DECL, decls)

// ---------------------------------------------------------------------------
// 4. O bloco 2.c, entre o DP e o espelho de fronteira
// ---------------------------------------------------------------------------
const ANCORA_2B = '    -- 2.b ESPELHO DA BATIDA DE TRANSICAO SOLITARIA (20260823100000)'
if (corpo.split(ANCORA_2B).length - 1 !== 1) abortar('ancora do bloco 2.b nao encontrada uma unica vez')

const bloco2c = [
  '    -- 2.c FIXACAO POR TRATAMENTO DO COORDENADOR (20260917120000)',
  '    --',
  "    -- Os tipos 'vincular_escala' e 'reclassificar_passo' existem em marcacoes_tratamentos",
  '    -- desde 20260808000000 e NINGUEM os honrava: fn_aceitar_marcacao_pendente GRAVA',
  "    -- 'vincular_escala' e esta funcao so consultava tratamento para 'desconsiderar'. Na",
  '    -- pratica havia uma unica alavanca duravel sobre a alocacao -- RETIRAR uma batida. Dizer',
  '    -- "esta batida e a saida, nao a entrada" nao tinha como ser dito de um jeito que a',
  '    -- reconciliacao respeitasse: ela reescreve escala_diaria a partir da projecao, sem',
  '    -- COALESCE, e desfazia a correcao na primeira vez que o dia fosse reconciliado.',
  '    --',
  "    -- 🚨 SO 'reclassificar_passo' E HONRADO. 'vincular_escala' FICA DE FORA, e o motivo e",
  '    --    medicao, nao gosto: em 17/09/2026 havia 1.686 tratamentos vincular_escala gravados em',
  '    --    producao (fn_aceitar_marcacao_pendente grava um a cada aceite manual, desde agosto).',
  '    --    Honra-los aqui ligaria 1.437 fixacoes de uma vez -- e 92 delas DISCORDAM do que esta',
  '    --    gravado hoje em escala_diaria, incluindo competencias fechadas e folhas revisadas.',
  '    --    Seria mudar 92 pontos de servidor publico sem ninguem ter pedido, em uma migration.',
  '    --',
  "    --    'reclassificar_passo' tinha ZERO ocorrencias na base, entao honra-lo nao move nada do",
  '    --    passado: e o corte, sem data magica nenhuma. E e o tipo semanticamente certo -- o',
  '    --    comentario do CHECK original ja o define como "forca entrada/int_saida/int_retorno/',
  '    --    saida", enquanto vincular_escala e "forca a escala_diaria de destino".',
  '    --',
  '    -- A FIXACAO AGE POR CIMA DO DP, NUNCA DENTRO DELE.',
  '    -- O alinhamento e monotonico; furar um slot no meio dele desalinharia todo o resto. Aqui',
  '    -- o DP roda exatamente como hoje e depois o juizo explicito sobrescreve o vencedor do',
  '    -- slot. Quem nao tem tratamento nao ve diferenca nenhuma -- e o que torna esta mudanca',
  '    -- segura num caminho que decide ponto de servidor publico.',
  '    --',
  '    -- ⚠️ O EFETIVO E O ULTIMO TRATAMENTO DA MARCACAO, por created_at. O coordenador pode',
  '    --    mudar de ideia, e uma batida so pode estar em UM passo -- por isso DISTINCT ON',
  '    --    (marcacao_id), e nao um por (linha, passo).',
  '    --',
  '    -- ⚠️ A batida fixada pode nem ter entrado nas candidatas do DP (fora da janela, de outra',
  '    --    unidade, descartada como duplicada). Isso e DE PROPOSITO: aquelas defesas sao',
  '    --    automaticas e esta e a decisao de uma pessoa, registrada, com autor e justificativa.',
  '    --    Ela vence -- e sai da lista de pendencias logo abaixo, para a mesma batida nao',
  '    --    aparecer alocada e pendente na mesma resposta.',
  '    IF n_slots > 0 THEN',
  '        FOR s_fix IN 1..n_slots LOOP',
  "            v_linhas := v_linhas || string_to_array(v_slot_ids[s_fix], ',')::uuid[];",
  '        END LOOP;',
  '',
  '        FOR rt IN',
  '            WITH ultimo AS (',
  '                SELECT DISTINCT ON (t.marcacao_id)',
  '                       t.marcacao_id, t.escala_diaria_id, t.passo_forcado, t.created_at',
  '                  FROM public.marcacoes_tratamentos t',
  "                 WHERE t.tipo = 'reclassificar_passo'",
  '                   AND t.passo_forcado   IS NOT NULL',
  '                   AND t.escala_diaria_id IS NOT NULL',
  '                   AND t.escala_diaria_id = ANY(v_linhas)',
  '                 ORDER BY t.marcacao_id, t.created_at DESC',
  '            )',
  '            SELECT u.marcacao_id, u.escala_diaria_id, u.passo_forcado,',
  '                   m.ocorrido_em, m.origem',
  '              FROM ultimo u',
  '              JOIN public.marcacoes_ponto m ON m.id = u.marcacao_id',
  '             WHERE NOT public.fn_marcacao_desconsiderada(u.marcacao_id)',
  '             ORDER BY u.created_at',
  '        LOOP',
  '            -- Acha o slot daquele passo NAQUELA linha. Numa fronteira a mesma linha tem dois',
  '            -- slots do mesmo passo (o do bloco e o opcional da transicao): o NAO opcional',
  '            -- ganha, porque e o passo principal do turno.',
  '            v_alvo_slot := NULL;',
  '            FOR s_fix IN 1..n_slots LOOP',
  '                IF v_slot_passo[s_fix] = rt.passo_forcado',
  "                   AND rt.escala_diaria_id = ANY(string_to_array(v_slot_ids[s_fix], ',')::uuid[]) THEN",
  '                    IF v_alvo_slot IS NULL OR NOT COALESCE(v_slot_opcional[s_fix], false) THEN',
  '                        v_alvo_slot := s_fix;',
  '                    END IF;',
  '                    EXIT WHEN NOT COALESCE(v_slot_opcional[s_fix], false);',
  '                END IF;',
  '            END LOOP;',
  '',
  '            CONTINUE WHEN v_alvo_slot IS NULL;',
  '',
  '            -- A mesma batida nao pode ficar em dois passos: tira do lugar onde o DP a pos.',
  '            FOR s_fix IN 1..n_slots LOOP',
  '                IF s_fix <> v_alvo_slot AND v_win_marcacao[s_fix] = rt.marcacao_id THEN',
  '                    v_win_marcacao[s_fix] := NULL;',
  '                    v_win_peso[s_fix]     := NULL;',
  '                    v_win_dist[s_fix]     := NULL;',
  '                END IF;',
  '            END LOOP;',
  '',
  '            -- Se o slot alvo tinha OUTRA batida, ela nao some: vira pendencia com tipo',
  '            -- proprio, para o coordenador ver o que o juizo dele deslocou.',
  '            IF v_win_marcacao[v_alvo_slot] IS NOT NULL',
  '               AND v_win_marcacao[v_alvo_slot] <> rt.marcacao_id THEN',
  '                v_pendencias := v_pendencias || jsonb_build_object(',
  "                    'tipo',          'substituida_por_tratamento',",
  "                    'marcacao_id',   v_win_marcacao[v_alvo_slot],",
  "                    'passo',         v_slot_passo[v_alvo_slot],",
  "                    'previsto',      v_slot_prev[v_alvo_slot],",
  "                    'substituida_por', rt.marcacao_id);",
  '            END IF;',
  '',
  '            v_dist_fix := abs(extract(epoch FROM (rt.ocorrido_em - v_slot_prev[v_alvo_slot])) / 60.0);',
  '            v_win_marcacao[v_alvo_slot] := rt.marcacao_id;',
  '            v_win_peso[v_alvo_slot]     := public.fn_precedencia_origem(rt.origem);',
  '            v_win_dist[v_alvo_slot]     := v_dist_fix;',
  '            v_fixadas := v_fixadas || rt.marcacao_id;',
  '        END LOOP;',
  '    END IF;',
  '',
  ANCORA_2B,
].join(EOL)
corpo = corpo.replace(ANCORA_2B, bloco2c)

// ---------------------------------------------------------------------------
// 5. Tira das pendencias o que foi fixado
// ---------------------------------------------------------------------------
const ANCORA_RET = '    RETURN jsonb_build_object('
if (corpo.split(ANCORA_RET).length - 1 !== 1) abortar('ancora do RETURN nao encontrada uma unica vez')
const filtro = [
  '    -- A batida FIXADA nao pode continuar listada como pendente: ela pode ter sido recusada',
  "    -- pelo DP (fora da janela, outra unidade) ou descartada como duplicada ANTES de a fixacao",
  '    -- ser aplicada. Aparecer nas duas listas faria a tela pedir decisao sobre o que ja foi',
  '    -- decidido.',
  '    IF COALESCE(array_length(v_fixadas, 1), 0) > 0 THEN',
  "        SELECT COALESCE(jsonb_agg(p), '[]'::jsonb) INTO v_pendencias",
  '          FROM jsonb_array_elements(v_pendencias) p',
  "         WHERE p->>'marcacao_id' IS NULL",
  "            OR NOT ((p->>'marcacao_id')::uuid = ANY(v_fixadas));",
  '    END IF;',
  '',
  ANCORA_RET,
].join(EOL)
corpo = corpo.replace(ANCORA_RET, filtro)

// ---------------------------------------------------------------------------
// 6. Invariantes DEPOIS
// ---------------------------------------------------------------------------
for (const [nome, marca] of INVARIANTES_FONTE) {
  if (!corpo.includes(marca)) abortar(`invariante perdido na copia: ${nome}`)
}
const checagens = [
  ['fixacao inserida', '2.c FIXACAO POR TRATAMENTO DO COORDENADOR'],
  ['fixacao ANTES do espelho', null],
  ['filtro de pendencias inserido', 'array_length(v_fixadas, 1)'],
  ['v_linhas declarado', '    v_linhas        uuid[]'],
  ['rt declarado', '    rt              record;'],
]
for (const [nome, marca] of checagens) if (marca && !corpo.includes(marca)) abortar('faltou: ' + nome)
if (corpo.indexOf('2.c FIXACAO POR TRATAMENTO DO COORDENADOR') > corpo.indexOf('2.b ESPELHO DA BATIDA')) {
  abortar('a fixacao ficou DEPOIS do espelho de fronteira; ela tem de vir antes para a batida ' +
    'de transicao fixada alcancar os dois lados da fronteira')
}
// O DP nao pode ter sido tocado: a contagem MEDIDA na fonte tem de se repetir na saida.
const custoDepois = (corpo.match(CUSTO) || []).length
if (custoDepois !== custoAntes) {
  abortar(`o DP foi alterado: a fonte tinha ${custoAntes} ocorrencias do custo de nao-casar, ` +
    `a saida tem ${custoDepois}`)
}

// ---------------------------------------------------------------------------
// 7. Escreve
// ---------------------------------------------------------------------------
const cabecalho = [
  '-- Migration: a alocacao passa a honrar tratamento de PASSO (vincular_escala/reclassificar_passo)',
  '-- Data: 2026-09-17',
  '-- Plano: docs/planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md (defeito D4)',
  '-- Gerada por scratchpad/gen_alocacao_tratamento_de_passo.js a partir de',
  '--   ' + vigente + ' (copia mecanica, armadilha 1). NAO EDITAR A MAO.',
  '--',
  '-- O QUE ESTAVA ERRADO',
  "--   marcacoes_tratamentos aceita 'vincular_escala' e 'reclassificar_passo' desde",
  '--   20260808000000, e fn_aceitar_marcacao_pendente GRAVA o primeiro a cada aceite. Nenhuma',
  '--   funcao os LIA: fn_alocar_marcacoes_dia consultava tratamento so para desconsiderar.',
  '--',
  '--   Consequencia: a unica correcao duravel possivel sobre uma batida era RETIRA-LA. Trocar a',
  '--   batida de um passo ("as 18:21 nao sao a saida do plantao, sao a entrada do noturno") so',
  '--   podia ser escrito direto em escala_diaria -- que e cache: fn_reconciliar_marcacoes_dia',
  '--   reescreve todos os passos a partir da projecao, sem COALESCE, e desfaz a correcao na',
  '--   primeira reconciliacao daquele dia.',
  '--',
  '-- O QUE MUDA',
  '--   Um bloco novo (2.c), entre o DP e o espelho de fronteira, sobrescreve o vencedor do slot',
  '--   quando existe tratamento de passo vigente. O DP em si NAO foi tocado -- as linhas de',
  '--   custo do alinhamento continuam identicas, conferido pelo gerador.',
  '--',
  "-- 🚨 SO 'reclassificar_passo', NUNCA 'vincular_escala'",
  '--   Medido em producao em 17/09/2026: 1.686 tratamentos vincular_escala ja gravados, 1.437',
  '--   ainda vigentes, e 92 deles DISCORDAM do que esta em escala_diaria hoje. Honra-los aqui',
  '--   mudaria 92 pontos de uma vez, em competencia fechada e folha revisada, sem ninguem pedir.',
  "--   'reclassificar_passo' tinha ZERO ocorrencias: e o corte, e nao precisa de data magica.",
  '--',
  '-- ORDEM DE APLICACAO',
  '--   Depende de 20260917110000 (fn_marcacao_desconsiderada).',
  '',
  '',
].join(EOL)

const conferencia = fs.readFileSync(path.join(__dirname, 'conf_alocacao_tratamento.sql'), 'utf8')
  .replace(/\r?\n/g, EOL)

fs.writeFileSync(SAIDA, cabecalho + corpo + EOL + EOL + conferencia, 'utf8')
console.log('escrito: ' + path.basename(SAIDA))
console.log('  invariantes da fonte: ' + INVARIANTES_FONTE.length + ' preservados')
console.log(`  DP intacto: ${custoAntes} ocorrencias do custo de nao-casar`)
