#!/usr/bin/env node
/**
 * Gera 20260915130000_abrangencia_do_relogio_gravacao.sql
 *
 * Copia fn_definir_setores_dispositivo_rep da migration VIGENTE (20260911100000) e:
 *   1. deixa de RECUSAR setor de outra unidade (passa a exigir escopo NAS DUAS unidades)
 *   2. passa a gravar dispositivos_rep.atende_toda_unidade
 *   3. recusa deixar o relogio sem atender NINGUEM
 *
 * 🚨 POR QUE ISTO E URGENTE, e nao um acabamento:
 *    Com 20260915100000/110000/120000 aplicadas e esta NAO aplicada, a tela grava so as linhas
 *    e nunca a coluna. Dois estados errados passam a ser alcancaveis pela tela:
 *      - marcar "toda a unidade" num relogio que tinha lista  -> linhas apagadas, coluna
 *        continua false -> o relogio passa a NAO ATENDER NINGUEM;
 *      - desmarcar e escolher setores num relogio "toda a unidade" -> linhas entram, coluna
 *        continua true -> a restricao que a pessoa quis fazer simplesmente nao acontece.
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260911100000_escopo_de_gestao_para_rh.sql')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260915130000_abrangencia_do_relogio_gravacao.sql')

const bruto = fs.readFileSync(FONTE, 'utf8')
const crlf = (bruto.match(/\r\n/g) || []).length
const lf = (bruto.match(/\n/g) || []).length
if (crlf !== 0 && crlf !== lf) { console.error(`ABORTADO: EOL misto (${crlf}/${lf}).`); process.exit(1) }
const EOL = crlf > 0 ? '\r\n' : '\n'
console.log(`fonte: ${path.basename(FONTE)}  EOL=${EOL === '\r\n' ? 'CRLF' : 'LF'}`)

const INI = 'CREATE OR REPLACE FUNCTION public.fn_definir_setores_dispositivo_rep('
const i = bruto.indexOf(INI)
if (i < 0) { console.error('ABORTADO: funcao nao encontrada.'); process.exit(1) }
const j = bruto.indexOf(`${EOL}$fn$;`, i)
if (j < 0) { console.error('ABORTADO: fim nao encontrado.'); process.exit(1) }
let fn = bruto.slice(i, j + `${EOL}$fn$;`.length)
console.log(`fn_definir_setores_dispositivo_rep: ${fn.split(EOL).length} linhas copiadas`)

const INVARIANTES = [
  ['guard de escopo de gestao', /fn_escopo_gestao_alcanca/],
  ['substituicao atomica',      /DELETE FROM public\.dispositivos_rep_setores/],
  ['dispositivo existe',        /nao encontrado/],
]
for (const [nome, re] of INVARIANTES) {
  if (!re.test(fn)) { console.error(`ABORTADO: invariante "${nome}" ausente.`); process.exit(1) }
  console.log(`  ok invariante ${nome}`)
}

function trocar(texto, de, para, esperado, rotulo) {
  const p = texto.split(de)
  if (p.length - 1 !== esperado) {
    console.error(`ABORTADO: "${rotulo}" casou ${p.length - 1}x, esperava ${esperado}x.`); process.exit(1)
  }
  console.log(`  ok troca ${rotulo}: ${esperado}x`)
  return p.join(para)
}
const L = (...l) => l.join(EOL)

// 1. assinatura ganha o parametro novo
fn = trocar(fn,
  L(`    p_dispositivo_id uuid,`,
    `    p_setor_ids      uuid[]`,
    `)`),
  L(`    p_dispositivo_id uuid,`,
    `    p_setor_ids      uuid[],`,
    `    -- NULL = nao mexer na coluna (preserva o comportamento de quem chamar com 2 argumentos`,
    `    -- durante a janela entre migration e deploy - armadilha 41).`,
    `    p_atende_toda_unidade boolean DEFAULT NULL`,
    `)`),
  1, 'parametro p_atende_toda_unidade')

// 2. declaracoes
fn = trocar(fn,
  L(`    v_invalidos  integer;`),
  L(`    v_invalidos  integer;`,
    `    v_fora       integer;`,
    `    v_toda       boolean;`),
  1, 'declaracoes novas')

// 3. O CONSERTO: setor de outra unidade deixa de ser recusado
fn = trocar(fn,
  L(`    -- Nenhum setor pode ser de outra unidade - o dispositivo so atende a propria unidade`,
    `    -- (dispositivos_rep.unidade_id continua unico por dispositivo, ver plano de 13/08/2026).`,
    `    SELECT count(*) INTO v_invalidos`,
    `      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)`,
    `     WHERE NOT EXISTS (`,
    `         SELECT 1 FROM public.setores se WHERE se.id = s.id AND se.unidade_id = v_unidade_id`,
    `     );`,
    `    IF v_invalidos > 0 THEN`,
    `        RAISE EXCEPTION '% setor(es) informado(s) nao pertence(m) a unidade deste dispositivo.', v_invalidos;`,
    `    END IF;`),
  L(`    -- 15/09/2026: setor de OUTRA unidade passou a ser permitido - e o caso do setor que`,
    `    -- funciona FISICAMENTE dentro de outro predio (os 4 polos do CAF). O que continua`,
    `    -- proibido e setor que nao existe.`,
    `    SELECT count(*) INTO v_invalidos`,
    `      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)`,
    `     WHERE NOT EXISTS (SELECT 1 FROM public.setores se WHERE se.id = s.id);`,
    `    IF v_invalidos > 0 THEN`,
    `        RAISE EXCEPTION '% setor(es) informado(s) nao existe(m).', v_invalidos;`,
    `    END IF;`,
    ``,
    `    -- 🚨 O ato alcanca DUAS unidades: as pessoas daquele setor passam a ser enfileiradas`,
    `    -- para este equipamento e a ter a batida aceita nele. Quem so administra a unidade do`,
    `    -- relogio nao pode decidir sozinho pela unidade do setor - mesma regra que ja vale para`,
    `    -- avaliar transferencia (origem E destino no escopo).`,
    `    SELECT count(*) INTO v_fora`,
    `      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)`,
    `      JOIN public.setores se ON se.id = s.id`,
    `     WHERE se.unidade_id IS DISTINCT FROM v_unidade_id`,
    `       AND NOT public.fn_escopo_gestao_alcanca(se.unidade_id);`,
    `    IF v_fora > 0 THEN`,
    `        RAISE EXCEPTION 'Sem permissao sobre a unidade de % setor(es) de fora informado(s).', v_fora`,
    `            USING ERRCODE = 'insufficient_privilege';`,
    `    END IF;`,
    ``,
    `    -- NULL = manter o que esta la.`,
    `    SELECT COALESCE(p_atende_toda_unidade, d.atende_toda_unidade) INTO v_toda`,
    `      FROM public.dispositivos_rep d WHERE d.id = p_dispositivo_id;`,
    ``,
    `    -- 🚨 RELOGIO QUE NAO ATENDE NINGUEM. Sem este guard o estado e alcancavel pela tela:`,
    `    -- marcar "toda a unidade" num relogio que tinha lista apaga as linhas, e se a coluna`,
    `    -- ficasse false o equipamento pararia de cobrir qualquer pessoa - em silencio, e o`,
    `    -- sintoma apareceria dias depois como "o ponto daquela unidade sumiu".`,
    `    IF NOT v_toda AND COALESCE(array_length(p_setor_ids, 1), 0) = 0 THEN`,
    `        RAISE EXCEPTION 'Este relogio ficaria sem atender nenhum setor. Marque "toda a unidade" ou escolha ao menos um setor.';`,
    `    END IF;`),
  1, 'aceita setor de fora, exige escopo nas duas unidades, recusa relogio orfao')

// 4. grava a coluna junto (mesma transacao do delete/insert)
fn = trocar(fn,
  L(`    DELETE FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;`),
  L(`    UPDATE public.dispositivos_rep SET atende_toda_unidade = v_toda`,
    `     WHERE id = p_dispositivo_id;`,
    ``,
    `    DELETE FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;`),
  1, 'grava atende_toda_unidade')

// 5. retorno diz o que mudou (armadilha 22)
fn = trocar(fn,
  `    RETURN jsonb_build_object('setores_definidos', v_definidos);`,
  L(`    RETURN jsonb_build_object('setores_definidos', v_definidos,`,
    `                              'atende_toda_unidade', v_toda,`,
    `                              'setores_de_outra_unidade', (`,
    `                                  SELECT count(*) FROM public.dispositivos_rep_setores ds`,
    `                                    JOIN public.setores se ON se.id = ds.setor_id`,
    `                                   WHERE ds.dispositivo_id = p_dispositivo_id`,
    `                                     AND se.unidade_id IS DISTINCT FROM v_unidade_id));`),
  1, 'retorno relata a coluna e os setores de fora')

for (const [nome, re] of INVARIANTES) {
  if (!re.test(fn)) { console.error(`ABORTADO: invariante "${nome}" sumiu.`); process.exit(1) }
}
if ((fn.match(/\$fn\$/g) || []).length !== 2) { console.error('ABORTADO: $fn$ desbalanceado.'); process.exit(1) }
console.log('  ok invariantes pos-troca')

const cabecalho = L(
'-- Migration: abrangencia do relogio REP - GRAVACAO (parte 4, fecha o caminho da tela)',
'-- Data: 2026-09-15',
'--',
'-- Gerada por scratchpad/gen_abrangencia_gravacao.js a partir de 20260911100000.',
'-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md',
'--',
'-- DEPENDE DE 20260915100000. Vai JUNTO com o deploy que manda p_atende_toda_unidade.',
'--',
'-- 🚨 ISTO FECHA UM RISCO ABERTO PELAS TRES ANTERIORES',
'--   Com a coluna atende_toda_unidade criada e a tela ainda gravando so as linhas, dois estados',
'--   errados ficaram alcancaveis pela tela de Dispositivo REP:',
'--     a) marcar "toda a unidade" num relogio que tinha lista -> as linhas sao apagadas e a',
'--        coluna continua false: o equipamento passa a NAO ATENDER NINGUEM, em silencio;',
'--     b) desmarcar e escolher setores num relogio "toda a unidade" -> as linhas entram e a',
'--        coluna continua true: a restricao pedida simplesmente nao acontece.',
'--   A RPC passa a gravar a coluna na MESMA transacao das linhas, e recusa (a).',
'--',
'-- O QUE MAIS MUDA',
'--   Setor de OUTRA unidade deixa de ser recusado - era a trava final para o caso dos polos do',
'--   CAF. Em troca, exige escopo de gestao NAS DUAS unidades: o ato faz as pessoas daquele setor',
'--   passarem a ser enfileiradas e a bater neste equipamento, entao quem so administra a unidade',
'--   do relogio nao decide sozinho pela unidade do setor (mesma regra da avaliacao de',
'--   transferencia, que exige origem E destino no escopo).',
'--',
'-- ⚠️ ASSINATURA NOVA = OBJETO NOVO (armadilha 41): a de 2 argumentos e DERRUBADA (duas',
'--   sobrecargas fariam o PostgREST devolver PGRST203) e os REVOKE/GRANT sao REESCRITOS, porque',
'--   funcao nova nasce com EXECUTE para PUBLIC (armadilha 24). O parametro novo tem DEFAULT NULL',
'--   para que uma chamada de 2 argumentos - o deploy anterior, durante a janela - continue',
'--   funcionando exatamente como antes.',
'',
'',
'DROP FUNCTION IF EXISTS public.fn_definir_setores_dispositivo_rep(uuid, uuid[]);',
'',
'')

const rodape = L(
'',
'',
'REVOKE ALL ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[], boolean) FROM PUBLIC, anon;',
'GRANT EXECUTE ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[], boolean)',
'    TO authenticated, service_role;',
'',
'',
'-- ============================================================================',
'-- CONFERENCIA (executa a funcao - armadilha 42)',
'-- ============================================================================',
'DO $conf$',
'DECLARE',
'    v_disp   uuid;',
'    v_uni    uuid;',
'    v_setor  uuid;',
'    v_fora   uuid;',
'    v_r      jsonb;',
'    v_antes  boolean;',
'    v_orig   uuid[];',
'    v_erro   text;',
'BEGIN',
'    IF to_regprocedure(\'public.fn_definir_setores_dispositivo_rep(uuid, uuid[])\') IS NOT NULL THEN',
'        RAISE EXCEPTION \'ABORTADO: a sobrecarga de 2 argumentos sobreviveu - PostgREST devolveria PGRST203.\';',
'    END IF;',
'    IF has_function_privilege(\'anon\', \'public.fn_definir_setores_dispositivo_rep(uuid, uuid[], boolean)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: anon pode executar a funcao nova.\';',
'    END IF;',
'    IF NOT has_function_privilege(\'authenticated\', \'public.fn_definir_setores_dispositivo_rep(uuid, uuid[], boolean)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: authenticated nao pode executar a funcao nova.\';',
'    END IF;',
'    RAISE NOTICE \'ok  assinatura unica e privilegios corretos\';',
'',
'    -- Ensaio funcional, revertido no fim por RAISE.',
'    SELECT d.id, d.unidade_id, d.atende_toda_unidade INTO v_disp, v_uni, v_antes',
'      FROM public.dispositivos_rep d WHERE d.ativo ORDER BY d.created_at LIMIT 1;',
'    IF v_disp IS NULL THEN',
'        RAISE NOTICE \'-   sem dispositivo para o ensaio funcional\';',
'        RETURN;',
'    END IF;',
'    SELECT id INTO v_setor FROM public.setores WHERE unidade_id = v_uni LIMIT 1;',
'    SELECT id INTO v_fora  FROM public.setores WHERE unidade_id IS DISTINCT FROM v_uni LIMIT 1;',
'',
'    -- 🚨 GUARDA A LISTA REAL ANTES DE MEXER. O ensaio roda contra um dispositivo de PRODUCAO:',
'    -- sem isto, a restauracao devolveria a coluna e deixaria o relogio sem os setores que ele',
'    -- atendia - apagando configuracao de verdade para provar um ponto.',
'    SELECT COALESCE(array_agg(setor_id), \'{}\'::uuid[]) INTO v_orig',
'      FROM public.dispositivos_rep_setores WHERE dispositivo_id = v_disp;',
'',
'    -- 1. Relogio sem atender ninguem tem que ser RECUSADO.',
'    BEGIN',
'        v_r := public.fn_definir_setores_dispositivo_rep(v_disp, ARRAY[]::uuid[], false);',
'        RAISE EXCEPTION \'ABORTADO: aceitou deixar o relogio sem atender nenhum setor.\';',
'    EXCEPTION WHEN others THEN',
'        GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;',
'        IF v_erro LIKE \'ABORTADO:%\' THEN RAISE; END IF;',
'        RAISE NOTICE \'ok  recusa relogio sem nenhum setor ("%")\', left(v_erro, 60);',
'    END;',
'',
'    -- 2. Setor de OUTRA unidade passa a ser aceito (service_role alcanca tudo).',
'    IF v_fora IS NOT NULL THEN',
'        v_r := public.fn_definir_setores_dispositivo_rep(v_disp, ARRAY[v_fora], true);',
'        IF (v_r->>\'setores_de_outra_unidade\')::integer < 1 THEN',
'            RAISE EXCEPTION \'ABORTADO: setor de outra unidade nao foi gravado (retorno %).\', v_r;',
'        END IF;',
'        IF NOT (SELECT atende_toda_unidade FROM public.dispositivos_rep WHERE id = v_disp) THEN',
'            RAISE EXCEPTION \'ABORTADO: a coluna atende_toda_unidade nao foi gravada.\';',
'        END IF;',
'        RAISE NOTICE \'ok  setor de outra unidade aceito E coluna gravada: %\', v_r;',
'    END IF;',
'',
'    RAISE EXCEPTION \'CONFERENCIA OK - ensaio revertido de proposito\';',
'END;',
'$conf$;',
'')

// A conferencia termina com RAISE proposital, o que abortaria a migration inteira. Ela precisa
// rodar num bloco que engole o proprio sucesso - senao o DDL acima seria revertido junto.
const conferenciaEnvolvida = rodape.replace(
  `    RAISE EXCEPTION 'CONFERENCIA OK - ensaio revertido de proposito';${EOL}END;${EOL}$conf$;`,
  L(`    -- O ensaio precisa ser desfeito SEM derrubar o DDL desta migration (um RAISE aqui`,
    `    -- reverteria a migration inteira), entao o estado original e restaurado a mao:`,
    `    -- a coluna E a lista de setores que o dispositivo tinha antes.`,
    `    DELETE FROM public.dispositivos_rep_setores WHERE dispositivo_id = v_disp;`,
    `    INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id)`,
    `    SELECT v_disp, s.id FROM unnest(v_orig) s(id);`,
    `    UPDATE public.dispositivos_rep SET atende_toda_unidade = v_antes WHERE id = v_disp;`,
    ``,
    `    -- Prova da restauracao: se sobrar diferenca, a migration aborta e nada e aplicado.`,
    `    IF (SELECT COALESCE(array_agg(setor_id ORDER BY setor_id), '{}'::uuid[])`,
    `          FROM public.dispositivos_rep_setores WHERE dispositivo_id = v_disp)`,
    `       IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), '{}'::uuid[]) FROM unnest(v_orig) x) THEN`,
    `        RAISE EXCEPTION 'ABORTADO: o ensaio nao restaurou os setores originais do dispositivo %.', v_disp;`,
    `    END IF;`,
    `    IF (SELECT atende_toda_unidade FROM public.dispositivos_rep WHERE id = v_disp) IS DISTINCT FROM v_antes THEN`,
    `        RAISE EXCEPTION 'ABORTADO: o ensaio nao restaurou atende_toda_unidade do dispositivo %.', v_disp;`,
    `    END IF;`,
    `    RAISE NOTICE 'ok  ensaio revertido e estado original conferido';`,
    `END;`,
    `$conf$;`))

fs.writeFileSync(SAIDA, cabecalho + fn + conferenciaEnvolvida, 'utf8')
console.log(`\nescrito: ${path.relative(RAIZ, SAIDA)}  (${fs.readFileSync(SAIDA, 'utf8').split(EOL).length} linhas)`)
