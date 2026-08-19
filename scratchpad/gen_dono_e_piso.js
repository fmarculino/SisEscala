/**
 * Gera a migration que impede uma batida de um dia de virar passo de OUTRO dia
 * em fn_alocar_marcacoes_dia.
 *
 * POR QUE POR SCRIPT (armadilha 1 do CLAUDE.md)
 *   A funcao e recriada inteira por CREATE OR REPLACE. Redigitar o corpo a mao ja apagou
 *   logica critica seis vezes neste projeto. Aqui o corpo vigente e COPIADO byte a byte do
 *   arquivo que o define hoje, e so os pontos alvo sao trocados — com contagem conferida.
 *
 * O QUE MUDA (duas regras, seis pontos de insercao)
 *   1. PISO DE MEIA-NOITE  - um passo nunca casa com batida anterior a meia-noite do dia
 *      civil em que o BLOCO daquele passo comeca.
 *   2. REGRA DO DONO       - batida cujo passo previsto mais proximo pertence a um bloco de
 *      dia vizinho (que nao entra nos slots deste dia) nao e candidata aqui.
 */

const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const ORIGEM = '20260819120000_cap_allocation_match_distance.sql'
const DESTINO = '20260819180000_dono_da_batida_e_piso_de_meia_noite.sql'

const bruto = fs.readFileSync(path.join(DIR, ORIGEM), 'utf8')

// ---- 1. Extrair APENAS fn_alocar_marcacoes_dia do arquivo vigente -----------------
const INI = 'CREATE OR REPLACE FUNCTION public.fn_alocar_marcacoes_dia('
const iIni = bruto.indexOf(INI)
if (iIni < 0) { console.error('ABORTADO: nao achei fn_alocar_marcacoes_dia em ' + ORIGEM); process.exit(1) }
const FIM = '$fnaloc$;'
const iFim = bruto.indexOf(FIM, iIni)
if (iFim < 0) { console.error('ABORTADO: nao achei o delimitador de fim $fnaloc$;'); process.exit(1) }
let corpo = bruto.slice(iIni, iFim + FIM.length)

const conta = (txt, agulha) => txt.split(agulha).length - 1

// ---- 2. Invariantes ANTES ---------------------------------------------------------
const DECL_SLOTS = "    v_slot_data     date[]        := '{}';"
const N_SLOTS = '    n_slots := COALESCE(array_length(v_slot_passo, 1), 0);'
const DECL_ANT_ID = '            v_ant_id    uuid;'
const ABRE_LOOP = '            LOOP\r\n                IF v_ant_ts IS NOT NULL'
const COND_DP = '                    IF v_dist <= v_tol_ontem\r\n                       AND v_custo[(k - 1) * (n_slots + 1) + (s - 1) + 1] + v_dist < v_melhor THEN'
const ATRIB_DATA = /( +)v_slot_data  := v_slot_data  \|\| r\.dia_ref;/g

const esperadoAntes = {
  [DECL_SLOTS]: 1,
  [N_SLOTS]: 1,
  [DECL_ANT_ID]: 1,
  [ABRE_LOOP]: 1,
  [COND_DP]: 1,
  'c_teto_alocacao_min constant integer := 720;': 1,
  'v_tol_ontem := LEAST(1440, c_teto_alocacao_min);': 1,
  'fn_blocos_previstos_dia': 1,
  '$fnaloc$': 2,
  'CREATE OR REPLACE FUNCTION': 1,
}
for (const [agulha, n] of Object.entries(esperadoAntes)) {
  const achou = conta(corpo, agulha)
  if (achou !== n) { console.error('ABORTADO: esperava ' + n + 'x "' + agulha.slice(0, 60) + '", achei ' + achou + '.'); process.exit(1) }
}
const nAtrib = (corpo.match(ATRIB_DATA) || []).length
if (nAtrib !== 4) { console.error('ABORTADO: esperava 4 atribuicoes de v_slot_data no loop de slots, achei ' + nAtrib + '.'); process.exit(1) }

// ---- 3. Substituicoes (SEMPRE funcao como 2o argumento: cifrao e literal) ---------
const L = a => a.join('\r\n')
let trocas = 0

// 3.1 declaracoes novas
corpo = corpo.replace(DECL_SLOTS, () => { trocas++; return L([
  DECL_SLOTS,
  "    -- Piso do slot: meia-noite do dia civil em que o BLOCO daquele passo comeca. Chegar",
  "    -- 'cedo' nunca significa chegar no dia civil anterior; se aconteceu, e anomalia para o",
  '    -- coordenador ver, nao alocacao silenciosa. Ver 20260819180000.',
  "    v_slot_piso     timestamptz[] := '{}';",
  '    -- Passos previstos dos blocos dos dias VIZINHOS que nao entram nos slots deste dia.',
  '    -- Nunca recebem alocacao: existem so para decidir de quem e a batida.',
  "    v_sombra_prev   timestamptz[] := '{}';",
  '    n_sombras       integer;',
]) })

// 3.2 piso junto de cada v_slot_data (4x, mesma expressao: o piso e do bloco, nao do passo)
corpo = corpo.replace(ATRIB_DATA, (m, ind) => { trocas++; return L([
  m,
  ind + "v_slot_piso  := v_slot_piso  || (date_trunc('day', r.inicio_previsto AT TIME ZONE v_timezone) AT TIME ZONE v_timezone);",
]) })

// 3.3 montagem dos slots-sombra, logo apos o loop dos slots reais
corpo = corpo.replace(N_SLOTS, () => { trocas++; return L([
  '    -- 1.b SLOTS-SOMBRA',
  '    -- Mesmos dias vizinhos, mas os blocos que NAO entraram acima: os de ontem que terminam',
  '    -- antes da meia-noite e todos os de amanha. Servem so de referencia de proximidade.',
  '    -- O guard de escopo de fn_blocos_previstos_dia levanta insufficient_privilege quando o',
  '    -- servidor nao tem escala no mes do dia vizinho (dia 1 e dia 31, chamada por usuario',
  '    -- autenticado). Ai a regra do dono simplesmente nao se aplica — o piso continua valendo.',
  '    BEGIN',
  '        FOR r IN',
  '            SELECT d.dia_ref, b.*',
  '              FROM (VALUES (p_data - 1), (p_data + 1)) AS d(dia_ref)',
  '              CROSS JOIN LATERAL public.fn_blocos_previstos_dia(p_servidor_id, d.dia_ref) b',
  '             WHERE NOT (d.dia_ref = p_data - 1 AND b.fim_previsto > v_meia_noite)',
  '             ORDER BY b.inicio_previsto',
  '        LOOP',
  '            v_sombra_prev := v_sombra_prev || r.inicio_previsto;',
  '            IF r.permite_intervalo AND r.intervalo_inicio_previsto IS NOT NULL THEN',
  '                v_sombra_prev := v_sombra_prev || r.intervalo_inicio_previsto;',
  '                v_sombra_prev := v_sombra_prev || COALESCE(r.intervalo_fim_previsto, r.intervalo_inicio_previsto);',
  '            END IF;',
  '            v_sombra_prev := v_sombra_prev || r.fim_previsto;',
  '        END LOOP;',
  '    EXCEPTION',
  '        WHEN insufficient_privilege THEN',
  "            v_sombra_prev := '{}';",
  '    END;',
  '',
  '    n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);',
  '',
  N_SLOTS,
]) })

// 3.4 variaveis do teste do dono, no DECLARE interno do laco por origem
corpo = corpo.replace(DECL_ANT_ID, () => { trocas++; return L([
  DECL_ANT_ID,
  '            v_ts_real   timestamptz;',
  '            v_ts_som    timestamptz;',
  '            v_d_real    numeric;',
  '            v_d_som     numeric;',
]) })

// 3.5 o teste do dono, ANTES da dedupe (batida de outro dia nao vira nem pendencia daqui)
corpo = corpo.replace(ABRE_LOOP, () => { trocas++; return L([
  '            LOOP',
  '                -- REGRA DO DONO: a batida e do dia cujo passo previsto esta mais perto dela.',
  '                -- Sem isto, a mesma batida podia ser a saida de ontem E a entrada de hoje —',
  '                -- cada dia reconcilia sozinho e nenhum sabe do outro. O desempate por',
  '                -- timestamp do slot garante que os dois dias cheguem a decisoes opostas:',
  '                -- exatamente um fica com ela.',
  '                IF n_sombras > 0 THEN',
  '                    SELECT t INTO v_ts_real FROM unnest(v_slot_prev) AS t',
  '                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;',
  '                    SELECT t INTO v_ts_som  FROM unnest(v_sombra_prev) AS t',
  '                     ORDER BY abs(extract(epoch FROM (r.ocorrido_em - t))), t LIMIT 1;',
  '                    IF v_ts_real IS NOT NULL AND v_ts_som IS NOT NULL THEN',
  '                        v_d_real := abs(extract(epoch FROM (r.ocorrido_em - v_ts_real)));',
  '                        v_d_som  := abs(extract(epoch FROM (r.ocorrido_em - v_ts_som)));',
  '                        IF v_d_som < v_d_real',
  '                           OR (v_d_som = v_d_real AND v_ts_som < v_ts_real) THEN',
  '                            CONTINUE;',
  '                        END IF;',
  '                    END IF;',
  '                END IF;',
  '',
  '                IF v_ant_ts IS NOT NULL',
]) })

// 3.6 o piso, na condicao de casamento do DP
corpo = corpo.replace(COND_DP, () => { trocas++; return L([
  '                    IF v_dist <= v_tol_ontem',
  '                       AND v_m_ts[k] >= v_slot_piso[s]',
  '                       AND v_custo[(k - 1) * (n_slots + 1) + (s - 1) + 1] + v_dist < v_melhor THEN',
]) })

if (trocas !== 9) { console.error('ABORTADO: esperava 9 substituicoes (5 pontuais + 4 do v_slot_data), fiz ' + trocas + '.'); process.exit(1) }

// ---- 4. Invariantes DEPOIS --------------------------------------------------------
const esperadoDepois = {
  "v_slot_piso     timestamptz[] := '{}';": 1,
  "v_sombra_prev   timestamptz[] := '{}';": 1,
  'v_slot_piso  := v_slot_piso  ||': 4,
  'n_sombras := COALESCE(array_length(v_sombra_prev, 1), 0);': 1,
  'AND v_m_ts[k] >= v_slot_piso[s]': 1,
  'WHEN insufficient_privilege THEN': 1,
  // o que NAO pode ter sumido na copia
  'c_teto_alocacao_min constant integer := 720;': 1,
  'v_tol_ontem := LEAST(1440, c_teto_alocacao_min);': 1,
  'IF v_dist <= v_tol_ontem': 1,
  'fn_precedencia_origem': 2,
  "'fora_da_janela'": 2,
  "'sem_escala'": 1,
  "'duplicada'": 1,
  'fn_blocos_previstos_dia': 3, // slots reais + slots-sombra + a mencao ao guard no comentario
  'rep_tolerancia_alocacao_minutos': 1,
  'SECURITY DEFINER': 1,
  'SET search_path = public': 1,
  '$fnaloc$': 2,
  'CREATE OR REPLACE FUNCTION': 1,
}
for (const [agulha, n] of Object.entries(esperadoDepois)) {
  const achou = conta(corpo, agulha)
  if (achou !== n) { console.error('ABORTADO (pos-troca): esperava ' + n + 'x "' + agulha.slice(0, 60) + '", achei ' + achou + '.'); process.exit(1) }
}

// ---- 5. Montar a migration --------------------------------------------------------
const cabecalho = [
  '-- ============================================================================',
  '-- Migration: a batida de um dia para de virar passo de OUTRO dia',
  '-- Data: 2026-08-19',
  '--',
  '-- PROBLEMA (medido em producao em 19/08/2026, competencia 08/2026)',
  '--   fn_alocar_marcacoes_dia roda por dia, e cada dia enxerga as batidas dos vizinhos sem',
  '--   saber o que o vizinho ja fez com elas. Caso real: servidor com jornada 08:00-18:00',
  '--   batendo 21:20 no dia 18 (saida com hora extra) e 08:23 no dia 19 (entrada). A batida',
  '--   das 21:20 esta a 640 min do slot de entrada do dia 19 — dentro do teto de 720 da',
  '--   20260819120000 — entao o dia 19 a tomou como ENTRADA e empurrou a batida real das',
  '--   08:23 para SAIDA PARA O INTERVALO. A mesma marcacao ficou gravada nos dois dias: saida',
  '--   do 18 e entrada do 19.',
  '--',
  '--   Duas causas independentes:',
  '--',
  '--   (1) Nada impede um passo de casar com batida de outro dia civil. O teto de 720 min',
  '--       cobre metade do periodo da escala, entao TODA batida da noite anterior (20:00 as',
  '--       24:00) alcanca o slot de entrada das 08:00 do dia seguinte.',
  '--   (2) O DP prefere quantidade a qualidade: o custo de nao casar (v_tol_ontem * 2) e',
  '--       sempre maior que o pior casamento aceito (<= v_tol_ontem), entao casar 640 + 217',
  '--       compensa mais do que casar 23 e deixar uma batida pendente.',
  '--',
  '-- CORRECAO — duas regras, nenhuma delas um numero novo para calibrar',
  '--',
  '--   PISO DE MEIA-NOITE. Um passo nunca casa com batida anterior a meia-noite do dia civil',
  '--   em que o BLOCO daquele passo comeca. Chegar cedo nunca significa chegar no dia civil',
  '--   anterior. Blocos que cruzam a meia-noite nao sao afetados: o piso e o do inicio do',
  '--   bloco, entao um plantao 18:00 -> 06:00 continua aceitando batida das 05:50 na saida.',
  '--',
  '--   REGRA DO DONO. A batida pertence ao dia cujo passo previsto esta mais perto dela. Os',
  '--   passos dos blocos dos dias vizinhos que nao entram nos slots do dia viram "sombras":',
  '--   nunca recebem alocacao, so desqualificam candidatas que sao do vizinho. O desempate',
  '--   (slot mais antigo vence no empate exato) garante que os dois dias cheguem a decisoes',
  '--   opostas — exatamente um deles fica com a batida, independente da ordem em que forem',
  '--   reconciliados.',
  '--',
  '-- MEDICAO SOBRE OS DADOS REAIS DE 08/2026 (scratchpad/simula_variantes_alocacao.js,',
  '-- que reproduz este DP passo a passo; 272 servidores, 6.774 blocos previstos)',
  '--',
  '--     variante                      | batida em 2 passos | dias impossiveis | dias que mudam',
  '--     ------------------------------|--------------------|------------------|---------------',
  '--     hoje (so teto 720)            |                 62 |                3 |             -',
  '--     + piso                        |                 34 |                0 |            32',
  '--     + piso + dono   (esta)        |                 15 |                0 |            55',
  '--     + custo de pular = teto/2     |                 13 |                0 |            58',
  '--',
  '--   Nenhuma das 55 mudancas perde alocacao plausivel: zero casos em que um passo tinha',
  '--   batida a <= 120 min do previsto e passou a nao ter.',
  '--',
  '--   A quarta linha (mexer no custo de nao casar) foi SIMULADA E DESCARTADA: corrige 2',
  '--   duplicacoes a mais e quebra tres dias saudaveis, entre eles uma jornada matutina cuja',
  '--   entrada real (06:57, a 3 min do previsto) passava a ser recusada. Nao aplicar sem',
  '--   evidencia nova.',
  '--',
  '-- O QUE ESTA MIGRATION NAO RESOLVE (medido, nao suposto)',
  '--   Restam 15 casos de batida em dois passos. Sao de dois tipos, nenhum deles o bug acima:',
  '--     - batida de TRANSICAO entre blocos encostados (noturno 18:00->07:00 seguido de',
  '--       plantao 07:00->19:00): a batida das 07:00 fecha um e abre o outro. E o',
  '--       comportamento desejado, ja documentado na armadilha 6 do CLAUDE.md.',
  '--     - instabilidade de um bloco que cruza a meia-noite, que e alocado tanto ao processar',
  '--       o dia dele quanto o dia seguinte, com conjuntos de slots concorrentes diferentes.',
  '--       O resultado gravado passa a depender de qual dia foi reconciliado por ultimo.',
  '--       Nao corrompe dia isolado; fica registrado como pendencia conhecida.',
  '--',
  '-- NAO CORRIGE O DADO JA GRAVADO. As linhas so se ajustam rodando a reconciliacao',
  '--   (fn_reconciliar_marcacoes_dia) depois desta migration — passo separado e deliberado,',
  '--   porque mexe em ponto ja projetado.',
  '--',
  '-- Corpo copiado mecanicamente de ' + ORIGEM,
  '-- por scratchpad/gen_dono_e_piso.js, que aborta se a contagem de ocorrencias divergir.',
  '-- ============================================================================',
  '',
  '',
]

const rodape = [
  '',
  'COMMENT ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer) IS',
  "    'Aloca marcacoes do dia nos passos previstos. Um passo nunca casa com batida anterior a '",
  "    'meia-noite do dia civil em que o bloco comeca (piso), e uma batida cujo passo previsto '",
  "    'mais proximo pertence a um bloco de dia vizinho nao e candidata aqui (regra do dono). '",
  "    'Teto de casamento de 720 min. Ver 20260819180000 e 20260819120000.';",
  '',
  'GRANT EXECUTE ON FUNCTION public.fn_alocar_marcacoes_dia(uuid, date, integer, integer)',
  '    TO authenticated, service_role;',
  '',
]

const saida = cabecalho.join('\r\n') + corpo + rodape.join('\r\n')

// ---- 6. Conferencia estrutural do arquivo inteiro ---------------------------------
const estrutura = {
  '$fnaloc$': 2,
  'CREATE OR REPLACE FUNCTION': 1,
  'GRANT EXECUTE': 1,
  'COMMENT ON FUNCTION': 1,
}
for (const [agulha, n] of Object.entries(estrutura)) {
  const achou = conta(saida, agulha)
  if (achou !== n) { console.error('ABORTADO (estrutura): esperava ' + n + 'x "' + agulha + '" no arquivo final, achei ' + achou + '.'); process.exit(1) }
}
if (/\n(?!\r)/.test(saida.replace(/\r\n/g, ''))) { console.error('ABORTADO: sobrou quebra de linha sem CR (o projeto usa CRLF).'); process.exit(1) }

fs.writeFileSync(path.join(DIR, DESTINO), saida)
console.log('OK: ' + DESTINO + ' (' + saida.split('\r\n').length + ' linhas, ' + trocas + ' substituicoes)')
