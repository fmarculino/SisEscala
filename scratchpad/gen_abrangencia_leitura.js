#!/usr/bin/env node
/**
 * Gera 20260915110000_abrangencia_do_relogio_leitura.sql
 *
 * Copia TRES funcoes das migrations vigentes (armadilha 1 - nao redigitar corpo):
 *   fn_cobertura_ponto_dispositivo <- 20260905100000   (arrasta o resumo e o enfileirar-por-escala)
 *   fn_enfileirar_cadastros_rep    <- 20260905110000
 *   fn_cobertura_escala_parque     <- 20260906110000
 *
 * ⚠️ fn_higiene_usuarios_dispositivo NAO entra: ela decide pode_remover por "existe servidor
 *    Ativo casando", nao por unidade - quem e do setor de fora ja fica protegido.
 * ⚠️ fn_cobertura_ponto_resumo NAO entra: e' envelope LATERAL de fn_cobertura_ponto_dispositivo.
 * ⚠️ fn_enfileirar_cadastros_por_escala NAO entra: deriva de fn_cobertura_ponto_dispositivo.
 *
 * PERFORMANCE: a cobertura ja viveu a 1,4s do statement_timeout (armadilha 54). O predicado
 * novo NAO e' aplicado como chamada de funcao por linha - isso tiraria o filtro seletivo de
 * unidade e faria varrer a rede inteira. A forma usada e' um ARRAY PEQUENO pre-computado
 * (unidades alcancadas / setores de fora), que mantem o ramo comum identico ao de hoje.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260915110000_abrangencia_do_relogio_leitura.sql')

const FONTES = {
  cobertura:   'supabase/migrations/20260905100000_cobertura_de_ponto_inclui_lotados.sql',
  enfileirar:  'supabase/migrations/20260905110000_fila_rep_nao_reenfileira_recusado.sql',
  parque:      'supabase/migrations/20260906110000_painel_cobertura_escala_parque.sql',
}

let EOL = null
const lidos = {}
for (const [k, rel] of Object.entries(FONTES)) {
  const bruto = fs.readFileSync(path.join(RAIZ, rel), 'utf8')
  const eol = bruto.includes('\r\n') ? '\r\n' : '\n'
  const misto = (bruto.match(/\n/g) || []).length - (bruto.match(/\r\n/g) || []).length
  if (eol === '\r\n' && misto !== 0) {
    console.error(`ABORTADO: ${rel} tem EOL MISTO (${misto} LF soltos). Padrao montado com um EOL vira no-op silencioso.`)
    process.exit(1)
  }
  if (EOL === null) EOL = eol
  else if (EOL !== eol) {
    console.error(`ABORTADO: fontes com EOL diferente (${rel}). Trate cada uma com o seu.`)
    process.exit(1)
  }
  lidos[k] = bruto
  console.log(`fonte ${k}: ${path.basename(rel)}  EOL=${eol === '\r\n' ? 'CRLF' : 'LF'}`)
}

// 20260905100000 e 20260906110000 usam `CREATE FUNCTION` precedido de DROP, porque na epoca
// MUDARAM a lista de colunas do RETURNS TABLE (42P13 exige DROP para isso). Aqui a lista de
// colunas NAO muda, entao normalizamos para CREATE OR REPLACE e nao derrubamos nada - derrubar
// levaria junto os dependentes (fn_cobertura_ponto_resumo, fn_enfileirar_cadastros_por_escala).
function extrair(bruto, nome, rotulo) {
  const alvos = [
    `CREATE OR REPLACE FUNCTION public.${nome}(`,
    `CREATE FUNCTION public.${nome}(`,
  ]
  let i = -1, usado = null
  for (const a of alvos) {
    const j = bruto.indexOf(a)
    if (j >= 0 && (i < 0 || j < i)) { i = j; usado = a }
  }
  if (i < 0) { console.error(`ABORTADO: ${rotulo} nao encontrada.`); process.exit(1) }
  const fim = bruto.indexOf(`${EOL}$fn$;${EOL}`, i)
  if (fim < 0) { console.error(`ABORTADO: fim de ${rotulo} nao encontrado.`); process.exit(1) }
  let fn = bruto.slice(i, fim + `${EOL}$fn$;`.length)
  if (!usado.startsWith('CREATE OR REPLACE')) {
    fn = `CREATE OR REPLACE FUNCTION public.${nome}(` + fn.slice(usado.length)
    console.log(`  ${rotulo}: normalizado CREATE -> CREATE OR REPLACE`)
  }
  console.log(`  ${rotulo}: ${fn.split(EOL).length} linhas copiadas`)
  return fn
}

function trocar(texto, de, para, esperado, rotulo) {
  const partes = texto.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error(`ABORTADO: "${rotulo}" casou ${achou}x, esperava ${esperado}x.`)
    process.exit(1)
  }
  console.log(`    ok ${rotulo}: ${achou}x`)
  return partes.join(para)
}
const L = (...l) => l.join(EOL)

// ===========================================================================
// 1. fn_cobertura_ponto_dispositivo
// ===========================================================================
console.log('\n[1] fn_cobertura_ponto_dispositivo')
let cob = extrair(lidos.cobertura,
  'fn_cobertura_ponto_dispositivo', 'fn_cobertura_ponto_dispositivo')

for (const [nome, re] of [
  ['uniao lotados+escalados', /UNION/],
  ['casamento por servidor_id resolvido', /u2\.servidor_id = b\.id/],
  ['guard de papel', /Sem permissao para ver a cobertura de ponto/],
]) {
  if (!re.test(cob)) { console.error(`ABORTADO: invariante "${nome}" ausente na fonte.`); process.exit(1) }
  console.log(`    ok invariante ${nome}`)
}

cob = trocar(cob,
  `    v_restrito    boolean;`,
  L(`    v_restrito    boolean;`,
    `    v_toda_uni    boolean;`,
    `    v_set_extra   uuid[];`,
    `    v_uni_alc     uuid[];`),
  1, 'declaracoes novas')

cob = trocar(cob,
  `    SELECT d.unidade_id INTO v_unidade_id`,
  `    SELECT d.unidade_id, d.atende_toda_unidade INTO v_unidade_id, v_toda_uni`,
  1, 'leitura de atende_toda_unidade')

cob = trocar(cob,
  L(`    SELECT EXISTS (`,
    `        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id`,
    `    ) INTO v_restrito;`),
  L(`    -- 15/09/2026: "restrito" passou a ser a COLUNA, nao a existencia de linhas. Sem isto,`,
    `    -- vincular um setor de OUTRA unidade tornaria o relogio "restrito" e ele perderia a`,
    `    -- unidade dona inteira - exatamente o que a coluna existe para impedir.`,
    `    v_restrito := NOT v_toda_uni;`,
    ``,
    `    -- Setores atendidos que NAO sao da unidade dona (o setor que funciona dentro de outro`,
    `    -- predio). Array pequeno de proposito: e' o que permite ampliar o alcance sem perder o`,
    `    -- filtro seletivo por unidade, que ja custou timeout nesta funcao (armadilha 54).`,
    `    SELECT COALESCE(array_agg(ds.setor_id), '{}'::uuid[])`,
    `      INTO v_set_extra`,
    `      FROM public.dispositivos_rep_setores ds`,
    `      JOIN public.setores s ON s.id = ds.setor_id`,
    `     WHERE ds.dispositivo_id = p_dispositivo_id`,
    `       AND s.unidade_id IS DISTINCT FROM v_unidade_id;`,
    ``,
    `    SELECT COALESCE(array_agg(DISTINCT x.uid), '{}'::uuid[])`,
    `      INTO v_uni_alc`,
    `      FROM (SELECT v_unidade_id AS uid`,
    `            UNION`,
    `            SELECT s.unidade_id FROM public.setores s WHERE s.id = ANY(v_set_extra)) x;`),
  1, 'v_restrito pela coluna + arrays de alcance')

// escalados
cob = trocar(cob,
  L(`           AND em.unidade_id = v_unidade_id`,
    `           AND (NOT v_restrito OR EXISTS (`,
    `                 SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = em.setor_id))`),
  L(`           -- Filtro seletivo preservado: v_uni_alc tem 1 elemento no caso dominante.`,
    `           AND em.unidade_id = ANY(v_uni_alc)`,
    `           AND ((em.unidade_id = v_unidade_id`,
    `                 AND (NOT v_restrito OR EXISTS (`,
    `                       SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                        WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = em.setor_id)))`,
    `                OR em.setor_id = ANY(v_set_extra))`),
  1, 'abrangencia no CTE escalados')

// lotados
cob = trocar(cob,
  L(`           AND s.unidade_id = v_unidade_id`,
    `           AND (NOT v_restrito OR EXISTS (`,
    `                 SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))`),
  L(`           AND s.unidade_id = ANY(v_uni_alc)`,
    `           AND ((s.unidade_id = v_unidade_id`,
    `                 AND (NOT v_restrito OR EXISTS (`,
    `                       SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                        WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id)))`,
    `                OR s.setor_id = ANY(v_set_extra))`),
  1, 'abrangencia no CTE lotados')

// ===========================================================================
// 2. fn_enfileirar_cadastros_rep
// ===========================================================================
console.log('\n[2] fn_enfileirar_cadastros_rep')
let enf = extrair(lidos.enfileirar,
  'fn_enfileirar_cadastros_rep', 'fn_enfileirar_cadastros_rep')

for (const [nome, re] of [
  ['nao reenfileira recusado', /fn_cadastro_rep_reprovado/],
  ['pula quem esta no snapshot', /rep_usuarios_dispositivo/],
  ['exige CPF', /sem_cpf/],
]) {
  if (!re.test(enf)) { console.error(`ABORTADO: invariante "${nome}" ausente na fonte.`); process.exit(1) }
  console.log(`    ok invariante ${nome}`)
}

enf = trocar(enf,
  `    v_restrito      boolean;`,
  L(`    v_restrito      boolean;`,
    `    v_toda_uni      boolean;`,
    `    v_set_extra     uuid[];`,
    `    v_uni_alc       uuid[];`),
  1, 'declaracoes novas')

enf = trocar(enf,
  L(`    SELECT unidade_id INTO v_unidade_id`,
    `      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;`),
  L(`    SELECT unidade_id, atende_toda_unidade INTO v_unidade_id, v_toda_uni`,
    `      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;`),
  1, 'leitura de atende_toda_unidade')

enf = trocar(enf,
  L(`    SELECT EXISTS (`,
    `        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id`,
    `    ) INTO v_restrito;`),
  L(`    -- 15/09/2026: ver o comentario equivalente em fn_cobertura_ponto_dispositivo.`,
    `    v_restrito := NOT v_toda_uni;`,
    ``,
    `    SELECT COALESCE(array_agg(ds.setor_id), '{}'::uuid[])`,
    `      INTO v_set_extra`,
    `      FROM public.dispositivos_rep_setores ds`,
    `      JOIN public.setores s ON s.id = ds.setor_id`,
    `     WHERE ds.dispositivo_id = p_dispositivo_id`,
    `       AND s.unidade_id IS DISTINCT FROM v_unidade_id;`,
    ``,
    `    SELECT COALESCE(array_agg(DISTINCT x.uid), '{}'::uuid[])`,
    `      INTO v_uni_alc`,
    `      FROM (SELECT v_unidade_id AS uid`,
    `            UNION`,
    `            SELECT s.unidade_id FROM public.setores s WHERE s.id = ANY(v_set_extra)) x;`),
  1, 'v_restrito pela coluna + arrays de alcance')

enf = trocar(enf,
  L(`           AND s.unidade_id = v_unidade_id`,
    `           AND (NOT v_restrito OR EXISTS (`,
    `                 SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))`),
  L(`           AND s.unidade_id = ANY(v_uni_alc)`,
    `           AND ((s.unidade_id = v_unidade_id`,
    `                 AND (NOT v_restrito OR EXISTS (`,
    `                       SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                        WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id)))`,
    `                OR s.setor_id = ANY(v_set_extra))`),
  1, 'abrangencia nos candidatos')

// ===========================================================================
// 3. fn_cobertura_escala_parque
// ===========================================================================
console.log('\n[3] fn_cobertura_escala_parque')
let paq = extrair(lidos.parque,
  'fn_cobertura_escala_parque', 'fn_cobertura_escala_parque')

for (const [nome, re] of [
  ['sem_relogio_no_setor', /sem_relogio_no_setor/],
  ['casa por servidor_id resolvido', /u\.servidor_id = e\.sid/],
]) {
  if (!re.test(paq)) { console.error(`ABORTADO: invariante "${nome}" ausente na fonte.`); process.exit(1) }
  console.log(`    ok invariante ${nome}`)
}

paq = trocar(paq,
  L(`        SELECT e.id AS escala_id, d.id AS dispositivo_id, d.nome AS dnome`,
    `          FROM escalas e`,
    `          JOIN public.dispositivos_rep d`,
    `            ON d.unidade_id = e.uid`,
    `           AND d.ativo`,
    `         WHERE NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                            WHERE ds.dispositivo_id = d.id)`,
    `            OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                        WHERE ds.dispositivo_id = d.id AND ds.setor_id = e.setid)`),
  L(`        -- 15/09/2026: o relogio passa a poder atender setor de OUTRA unidade. O JOIN`,
    `        -- continua ancorado em d.unidade_id = e.uid para nao perder a seletividade`,
    `        -- (armadilha 54); o segundo ramo so amplia para os POUCOS relogios que tem algum`,
    `        -- setor de fora - hoje, nenhum.`,
    `        SELECT e.id AS escala_id, d.id AS dispositivo_id, d.nome AS dnome`,
    `          FROM escalas e`,
    `          JOIN public.dispositivos_rep d`,
    `            ON d.ativo`,
    `           AND (d.unidade_id = e.uid`,
    `                OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores dx`,
    `                            JOIN public.setores sx ON sx.id = dx.setor_id`,
    `                           WHERE dx.dispositivo_id = d.id`,
    `                             AND sx.unidade_id IS DISTINCT FROM d.unidade_id))`,
    `         WHERE (d.atende_toda_unidade AND d.unidade_id = e.uid)`,
    `            OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds`,
    `                        WHERE ds.dispositivo_id = d.id AND ds.setor_id = e.setid)`),
  1, 'alvo: relogios que atendem o setor da escala')

// ===========================================================================
// 4. Monta
// ===========================================================================
const cabecalho = L(
'-- Migration: abrangencia do relogio REP - LEITURA (parte 2 de 3)',
'-- Data: 2026-09-15',
'--',
'-- Gerada por scratchpad/gen_abrangencia_leitura.js a partir de 20260905100000, 20260905110000',
'-- e 20260906110000 (corpos copiados, nao redigitados - armadilha 1).',
'-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md',
'--',
'-- DEPENDE DE 20260915100000 (a coluna atende_toda_unidade). Aplicar NESTA ORDEM.',
'--',
'-- O QUE MUDA: as tres funcoes deixam de perguntar "a pessoa e da unidade do relogio?" e passam',
'-- a perguntar "o relogio atende o setor dela?". Com isso o pessoal do POLO MORADA NOVA (setor',
'-- da SMS que funciona dentro da USF Carlos Barreto) passa a aparecer na Cobertura de Ponto',
'-- daquele relogio e a ser enfileirado para cadastro nele - assim que alguem vincular o setor.',
'--',
'-- ⚠️ ENQUANTO NINGUEM VINCULAR NADA, ESTA MIGRATION NAO MUDA UM NUMERO SEQUER. Nao existe',
'--    vinculo para setor de outra unidade hoje (medido: 0). A conferencia no fim PROVA isso',
'--    executando as funcoes antes/depois e comparando.',
'--',
'-- NAO ENTRAM AQUI, de proposito:',
'--   fn_cobertura_ponto_resumo          - envelope LATERAL de fn_cobertura_ponto_dispositivo',
'--   fn_enfileirar_cadastros_por_escala - deriva de fn_cobertura_ponto_dispositivo',
'--   fn_higiene_usuarios_dispositivo    - decide pode_remover por "existe servidor Ativo',
'--                                        casando", nunca por unidade: quem e do setor de fora',
'--                                        ja fica protegido de ser removido.',
'--',
'-- PERFORMANCE (armadilha 54: esta funcao ja esteve a 1,4s do statement_timeout de 8s)',
'--   O predicado novo NAO e aplicado como fn_dispositivo_atende_setor() por linha - isso',
'--   derrubaria o filtro por unidade e faria varrer a rede inteira. A forma usada e um array',
'--   pequeno pre-computado (v_uni_alc / v_set_extra): com nenhum setor de fora ele tem 1',
'--   elemento e o plano fica igual ao de hoje.',
'--',
'-- IDEMPOTENTE: so CREATE OR REPLACE, sem mudanca na lista de colunas de nenhum RETURNS TABLE',
'-- (mudar colunas exigiria DROP - armadilha do 42P13).',
'',
'',
'-- ============================================================================',
'-- 1. COBERTURA DE PONTO: o universo passa a ser a abrangencia do relogio',
'-- ============================================================================',
'-- Corpo copiado de 20260905100000. Mudam 5 trechos, todos conferidos por contagem.',
'-- Arrasta de graca fn_cobertura_ponto_resumo e fn_enfileirar_cadastros_por_escala.',
'')

const meio1 = L('', '',
'-- ============================================================================',
'-- 2. ENFILEIRAMENTO POR LOTACAO',
'-- ============================================================================',
'-- Corpo copiado de 20260905110000. Sem isto, o setor de fora apareceria na tela e nunca',
'-- chegaria ao equipamento - a tela diria "fora do relogio" para sempre.',
'')

const meio2 = L('', '',
'-- ============================================================================',
'-- 3. PAINEL DE COBERTURA DE ESCALA DO PARQUE',
'-- ============================================================================',
'-- Corpo copiado de 20260906110000. Sem isto o setor continuaria saindo como',
'-- "sem_relogio_no_setor" mesmo depois de vinculado ao relogio do predio onde ele fica.',
'')

const conferencia = L('', '',
'-- ============================================================================',
'-- 4. CONFERENCIA (roda junto, aborta a migration inteira se algo divergir)',
'-- ============================================================================',
'-- Armadilha 42: conferencia que so checa se a funcao existe nao serve - tem que EXECUTAR.',
'-- Confere os DOIS sentidos: nada mudou para quem ja era atendido (inercia), E o caminho novo',
'-- de fato funciona quando um setor de fora e vinculado (ensaio revertido).',
'',
'DO $conf$',
'DECLARE',
'    v_disp      record;',
'    v_n         integer;',
'    v_antes     integer;',
'    v_depois    integer;',
'    v_extra     uuid;',
'    v_uni_fora  uuid;',
'    v_total     integer := 0;',
'BEGIN',
'    -- 4.0 A parte 1 precisa estar aplicada.',
'    IF NOT EXISTS (SELECT 1 FROM information_schema.columns',
'                    WHERE table_schema = \'public\' AND table_name = \'dispositivos_rep\'',
'                      AND column_name = \'atende_toda_unidade\') THEN',
'        RAISE EXCEPTION \'ABORTADO: aplique 20260915100000 (coluna atende_toda_unidade) antes desta.\';',
'    END IF;',
'',
'    -- 4.1 INERCIA: com nenhum setor de fora vinculado, a cobertura de cada relogio ativo tem',
'    --     que devolver exatamente o mesmo tamanho de universo de antes. Como nao da para',
'    --     rodar a versao antiga aqui, a prova e a regra antiga reconstruida em SQL puro.',
'    FOR v_disp IN SELECT id, unidade_id, atende_toda_unidade FROM public.dispositivos_rep WHERE ativo LOOP',
'        SELECT count(*) INTO v_depois',
'          FROM public.fn_cobertura_ponto_dispositivo(v_disp.id, NULL, NULL);',
'',
'        SELECT count(DISTINCT sid) INTO v_antes FROM (',
'            SELECT em.servidor_id AS sid',
'              FROM public.escala_mensal em',
'              JOIN public.escala_diaria ed ON ed.escala_mensal_id = em.id',
'             WHERE em.mes = EXTRACT(MONTH FROM (now() AT TIME ZONE COALESCE((SELECT (valor#>>\'{}\')::text FROM public.configuracoes_globais WHERE chave = \'timezone\'), \'America/Sao_Paulo\'))::date)::integer',
'               AND em.ano = EXTRACT(YEAR  FROM (now() AT TIME ZONE COALESCE((SELECT (valor#>>\'{}\')::text FROM public.configuracoes_globais WHERE chave = \'timezone\'), \'America/Sao_Paulo\'))::date)::integer',
'               AND em.unidade_id = v_disp.unidade_id',
'               AND (v_disp.atende_toda_unidade OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds',
'                                                           WHERE ds.dispositivo_id = v_disp.id AND ds.setor_id = em.setor_id))',
'               AND ed.categoria IS NOT NULL AND ed.categoria::text <> \'Sobreaviso\'',
'               AND EXISTS (SELECT 1 FROM public.servidores s WHERE s.id = em.servidor_id AND s.status = \'Ativo\')',
'             UNION',
'            SELECT s.id',
'              FROM public.servidores s',
'             WHERE s.status = \'Ativo\' AND s.unidade_id = v_disp.unidade_id',
'               AND (v_disp.atende_toda_unidade OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds',
'                                                           WHERE ds.dispositivo_id = v_disp.id AND ds.setor_id = s.setor_id))',
'        ) x;',
'',
'        IF v_depois <> v_antes THEN',
'            RAISE EXCEPTION \'ABORTADO: universo do dispositivo % mudou (regra antiga=%, funcao nova=%).\',',
'                v_disp.id, v_antes, v_depois;',
'        END IF;',
'        v_total := v_total + 1;',
'    END LOOP;',
'    RAISE NOTICE \'ok  4.1 universo identico a regra antiga em % relogio(s) ativo(s)\', v_total;',
'',
'    -- 4.2 O SENTIDO NOVO, por ensaio: vincular um setor de outra unidade tem que AUMENTAR o',
'    --     universo daquele relogio. Sem esta prova, a migration poderia nao estar fazendo nada.',
'    SELECT d.id, d.unidade_id INTO v_disp FROM public.dispositivos_rep d WHERE d.ativo LIMIT 1;',
'    IF v_disp.id IS NOT NULL THEN',
'        SELECT s.id, s.unidade_id INTO v_extra, v_uni_fora',
'          FROM public.setores s',
'          JOIN public.servidores sv ON sv.setor_id = s.id AND sv.status = \'Ativo\'',
'         WHERE s.unidade_id IS DISTINCT FROM v_disp.unidade_id',
'         GROUP BY s.id, s.unidade_id HAVING count(*) > 0 LIMIT 1;',
'',
'        IF v_extra IS NOT NULL THEN',
'            SELECT count(*) INTO v_antes FROM public.fn_cobertura_ponto_dispositivo(v_disp.id, NULL, NULL);',
'            INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id)',
'                 VALUES (v_disp.id, v_extra) ON CONFLICT DO NOTHING;',
'            SELECT count(*) INTO v_depois FROM public.fn_cobertura_ponto_dispositivo(v_disp.id, NULL, NULL);',
'            DELETE FROM public.dispositivos_rep_setores',
'                  WHERE dispositivo_id = v_disp.id AND setor_id = v_extra;',
'',
'            IF v_depois <= v_antes THEN',
'                RAISE EXCEPTION \'ABORTADO: vincular setor de outra unidade nao ampliou o universo (antes=%, depois=%). A migration nao esta fazendo efeito.\', v_antes, v_depois;',
'            END IF;',
'            RAISE NOTICE \'ok  4.2 setor de outra unidade amplia o universo: % -> % (ensaio revertido)\', v_antes, v_depois;',
'        ELSE',
'            RAISE NOTICE \'-   4.2 pulado: nao ha setor de outra unidade com servidor ativo para o ensaio\';',
'        END IF;',
'    END IF;',
'',
'    -- 4.3 O vinculo de ensaio foi mesmo desfeito.',
'    SELECT count(*) INTO v_n',
'      FROM public.dispositivos_rep_setores ds',
'      JOIN public.dispositivos_rep d ON d.id = ds.dispositivo_id',
'      JOIN public.setores s          ON s.id = ds.setor_id',
'     WHERE s.unidade_id IS DISTINCT FROM d.unidade_id;',
'    IF v_n <> 0 THEN',
'        RAISE EXCEPTION \'ABORTADO: sobraram % vinculo(s) cruzado(s) do ensaio.\', v_n;',
'    END IF;',
'    RAISE NOTICE \'ok  4.3 nenhum vinculo cruzado residual\';',
'',
'    -- 4.4 Privilegios preservados nas tres.',
'    IF has_function_privilege(\'anon\', \'public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: anon ganhou execute em fn_cobertura_ponto_dispositivo.\';',
'    END IF;',
'    IF NOT has_function_privilege(\'authenticated\', \'public.fn_cobertura_ponto_dispositivo(uuid, integer, integer)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: authenticated PERDEU execute em fn_cobertura_ponto_dispositivo.\';',
'    END IF;',
'    RAISE NOTICE \'ok  4.4 privilegios preservados\';',
'END;',
'$conf$;',
'')

fs.writeFileSync(SAIDA, cabecalho + cob + meio1 + enf + meio2 + paq + conferencia, 'utf8')
const txt = fs.readFileSync(SAIDA, 'utf8')
for (const d of ['fn', 'conf']) {
  const n = (txt.match(new RegExp(`\\$${d}\\$`, 'g')) || []).length
  if (n % 2 !== 0) { console.error(`ABORTADO: delimitador $${d}$ impar (${n}).`); process.exit(1) }
}
console.log(`\nescrito: ${path.relative(RAIZ, SAIDA)}  (${txt.split(EOL).length} linhas)`)
