#!/usr/bin/env node
/**
 * Gera 20260915100000_abrangencia_do_relogio_estrutura.sql
 *
 * Copia fn_ingerir_afd da migration VIGENTE (nao redigita - CLAUDE.md armadilha 1) e aplica
 * substituicoes pontuais, abortando se qualquer contagem divergir.
 *
 * EOL e DETECTADO da fonte, nunca assumido (armadilha 59: 20260909160000 esta em LF enquanto
 * a convencao do projeto e CRLF; padrao montado com o EOL errado vira no-op silencioso).
 */
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const FONTE = path.join(RAIZ, 'supabase/migrations/20260906120000_geracao_do_equipamento.sql')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260915100000_abrangencia_do_relogio_estrutura.sql')

const bruto = fs.readFileSync(FONTE, 'utf8')
const EOL = bruto.includes('\r\n') ? '\r\n' : '\n'
console.log(`fonte: ${path.basename(FONTE)}  EOL=${EOL === '\r\n' ? 'CRLF' : 'LF'}`)

// ---------------------------------------------------------------------------
// 1. Extrai fn_ingerir_afd inteira, do CREATE ate o $fn$; que a fecha
// ---------------------------------------------------------------------------
const INI = 'CREATE OR REPLACE FUNCTION public.fn_ingerir_afd('
const iIni = bruto.indexOf(INI)
if (iIni < 0) { console.error('ABORTADO: fn_ingerir_afd nao encontrada na fonte.'); process.exit(1) }
const iFim = bruto.indexOf(`${EOL}$fn$;${EOL}`, iIni)
if (iFim < 0) { console.error('ABORTADO: fim de fn_ingerir_afd nao encontrado.'); process.exit(1) }
let fn = bruto.slice(iIni, iFim + `${EOL}$fn$;`.length)
console.log(`fn_ingerir_afd: ${fn.split(EOL).length} linhas copiadas`)

// ---------------------------------------------------------------------------
// 2. Invariantes ANTES de mexer - se a fonte nao for a que eu penso, aborta
// ---------------------------------------------------------------------------
const antes = [
  ['reconciliacao apos ingestao', /fn_reconciliar_marcacoes_dia/g, 1],
  ['geracao do equipamento',      /v_geracao/g,                    null],
  ['resolucao de identidade',     /fn_servidor_por_identificador_afd/g, null],
  ['guard de dispositivo',        /Dispositivo % nao cadastrado/g,  1],
]
for (const [nome, re, esperado] of antes) {
  const n = (fn.match(re) || []).length
  if (n === 0 || (esperado !== null && n !== esperado)) {
    console.error(`ABORTADO: invariante "${nome}" achou ${n} ocorrencia(s)${esperado !== null ? `, esperava ${esperado}` : ' (esperava >=1)'}.`)
    process.exit(1)
  }
  console.log(`  ok invariante ${nome}: ${n}`)
}

// ---------------------------------------------------------------------------
// 3. Substituicoes pontuais (2a arg SEMPRE funcao - armadilha do $$ e do $')
// ---------------------------------------------------------------------------
function trocar(texto, de, para, esperado, rotulo) {
  const partes = texto.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    console.error(`ABORTADO: "${rotulo}" casou ${achou}x, esperava ${esperado}x.`)
    process.exit(1)
  }
  console.log(`  ok troca ${rotulo}: ${achou}x`)
  return partes.join(para)
}

// 3.1 DECLARE ganha a variavel nova
fn = trocar(fn,
  `    v_unidade_id  uuid;`,
  `    v_unidade_id  uuid;${EOL}    v_toda_uni    boolean;`,
  1, 'declaracao de v_toda_uni')

// 3.2 carrega a coluna nova no mesmo SELECT que ja le o dispositivo
fn = trocar(fn,
  [`    SELECT unidade_id, geracao_atual INTO v_unidade_id, v_geracao`,
   `      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;`].join(EOL),
  [`    SELECT unidade_id, geracao_atual, atende_toda_unidade`,
   `      INTO v_unidade_id, v_geracao, v_toda_uni`,
   `      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;`].join(EOL),
  1, 'leitura de atende_toda_unidade')

// 3.3 O CONSERTO: o setor so e derivado quando o relogio atende EXCLUSIVAMENTE aquele setor
fn = trocar(fn,
  [`    IF v_n_setores = 1 THEN`].join(EOL),
  [`    -- 15/09/2026: so deriva o setor quando o relogio atende EXCLUSIVAMENTE um setor.`,
   `    -- Antes bastava haver 1 linha em dispositivos_rep_setores. Com a abrangencia podendo`,
   `    -- somar setor de OUTRA unidade a um relogio que continua atendendo a unidade dona`,
   `    -- inteira, aquela unica linha passaria a carimbar o setor da outra unidade em TODA`,
   `    -- batida do equipamento - inclusive nas de quem e da unidade dona. NULL e o valor`,
   `    -- honesto quando o relogio atende mais de um lugar.`,
   `    IF v_n_setores = 1 AND NOT v_toda_uni THEN`].join(EOL),
  1, 'derivacao do setor_id')

// ---------------------------------------------------------------------------
// 4. Invariantes DEPOIS
// ---------------------------------------------------------------------------
if ((fn.match(/v_toda_uni/g) || []).length !== 3) {
  console.error('ABORTADO: v_toda_uni deveria aparecer 3x (declaracao, SELECT INTO, IF).')
  process.exit(1)
}
for (const [nome, re] of antes.map(a => [a[0], a[1]])) {
  if (!(fn.match(re) || []).length) { console.error(`ABORTADO: invariante "${nome}" sumiu apos as trocas.`); process.exit(1) }
}
if ((fn.match(/\$fn\$/g) || []).length !== 2) {
  console.error('ABORTADO: delimitadores $fn$ desbalanceados.'); process.exit(1)
}
console.log('  ok invariantes pos-troca')

// ---------------------------------------------------------------------------
// 5. Monta a migration
// ---------------------------------------------------------------------------
const L = (...linhas) => linhas.join(EOL)

const cabecalho = L(
'-- Migration: abrangencia do relogio REP - ESTRUTURA (parte 1 de 3)',
'-- Data: 2026-09-15',
'--',
'-- Gerada por scratchpad/gen_abrangencia_estrutura.js a partir de',
'-- 20260906120000_geracao_do_equipamento.sql (fn_ingerir_afd copiada, nao redigitada).',
'-- Plano: docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md',
'--',
'-- MOTIVACAO',
'--   dispositivos_rep.unidade_id responde DE QUEM O RELOGIO E. Falta responder QUEM ELE ATENDE.',
'--   Medido em producao em 15/09/2026: os 4 polos do CAF (unidade SMS) funcionam fisicamente',
'--   dentro de OUTRAS unidades - 16 pessoas, zero batidas. O POLO MORADA NOVA fica dentro da USF',
'--   Carlos Barreto, cujo relogio tem 1 pessoa no universo e esta ocioso.',
'--',
'-- ESTA MIGRATION E INERTE. Ela nao muda o comportamento de nada: cria a coluna que separa',
'--   "toda a unidade" de "lista de setores", cria o predicado unico de abrangencia e conserta a',
'--   derivacao do setor da marcacao. Quem passa a USAR o predicado sao as migrations seguintes.',
'--',
'-- POR QUE A COLUNA E OBRIGATORIA (e vem ANTES de qualquer vinculo cruzado)',
'--   Hoje "0 linhas em dispositivos_rep_setores" = "toda a unidade". Dar ao relogio da USF CB a',
'--   PRIMEIRA linha (o setor do polo, de outra unidade) faria a USF Carlos Barreto inteira',
'--   PERDER o relogio, em silencio. A coluna e o que torna as duas coisas independentes.',
'--',
'-- POR QUE fn_ingerir_afd ENTRA JUNTO',
'--   Ela deriva marcacoes_ponto.setor_id quando o dispositivo tem exatamente 1 setor vinculado.',
'--   Sem o conserto, o relogio do CB com 1 linha (o polo) carimbaria setor_id = POLO MORADA NOVA',
'--   - um setor de outra unidade - em TODA batida dele, enquanto unidade_id continua sendo a USF.',
'--   Marcacao internamente incoerente, sem erro nenhum. Hoje o conserto e inerte: NENHUM relogio',
'--   do parque tem exatamente 1 setor vinculado (medido: 0, 5, 6, 6, 11, 11, 31, 160, 160, 160,',
'--   161 - e 24 relogios com 0).',
'--',
'-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, backfill condicionado, CREATE OR REPLACE.',
'-- Seguro reaplicar nos dois ambientes (armadilha 3).',
'',
'',
'-- ============================================================================',
'-- 1. A COLUNA QUE SEPARA "TODA A UNIDADE" DE "LISTA DE SETORES"',
'-- ============================================================================',
'',
'ALTER TABLE public.dispositivos_rep',
'    ADD COLUMN IF NOT EXISTS atende_toda_unidade boolean NOT NULL DEFAULT true;',
'',
'COMMENT ON COLUMN public.dispositivos_rep.atende_toda_unidade IS',
'    \'true = o relogio atende TODOS os setores da unidade dele (dispositivos_rep.unidade_id). \'',
'    \'Independente disso, dispositivos_rep_setores pode somar setores especificos - inclusive de \'',
'    \'OUTRA unidade, para o caso do setor que funciona fisicamente dentro de outro predio. \'',
'    \'Ate 15/09/2026 isto era implicito ("0 linhas em dispositivos_rep_setores"), o que impedia \'',
'    \'um relogio de atender a unidade inteira E um setor de fora ao mesmo tempo. \'',
'    \'Ver docs/planos/2026-09-15-relogio-que-atende-setor-de-outra-unidade.md.\';',
'',
'-- BACKFILL: reproduz exatamente a semantica anterior. Roda uma vez - a condicao no WHERE',
'-- impede que uma reaplicacao sobrescreva uma escolha feita depois pela tela.',
'DO $backfill$',
'DECLARE',
'    v_ajustados integer;',
'BEGIN',
'    IF EXISTS (SELECT 1 FROM public.dispositivos_rep WHERE NOT atende_toda_unidade) THEN',
'        RAISE NOTICE \'backfill: ja existe relogio com atende_toda_unidade = false - nada a fazer.\';',
'        RETURN;',
'    END IF;',
'',
'    UPDATE public.dispositivos_rep d',
'       SET atende_toda_unidade = false',
'     WHERE EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds',
'                    WHERE ds.dispositivo_id = d.id);',
'    GET DIAGNOSTICS v_ajustados = ROW_COUNT;',
'    RAISE NOTICE \'backfill: % relogio(s) com lista de setores marcados como NAO "toda a unidade".\', v_ajustados;',
'END;',
'$backfill$;',
'',
'',
'-- ============================================================================',
'-- 2. O PREDICADO UNICO DE ABRANGENCIA',
'-- ============================================================================',
'-- FONTE UNICA. Toda pergunta "este relogio atende esta pessoa/escala?" passa a sair daqui.',
'-- Replicar a regra em cada funcao e o que faz tela e banco divergirem (armadilha 62).',
'--',
'-- p_setor_id   pode ser NULL: servidor sem setor cadastrado. Nesse caso so o ramo da unidade',
'--              dona responde - que e exatamente o comportamento de hoje (o predicado antigo',
'--              "NOT EXISTS(lista)" nao olhava o setor da pessoa).',
'-- p_unidade_id e a unidade DA PESSOA/DA ESCALA, nao a do relogio.',
'',
'CREATE OR REPLACE FUNCTION public.fn_dispositivo_atende_setor(',
'    p_dispositivo_id uuid,',
'    p_setor_id       uuid,',
'    p_unidade_id     uuid',
')',
'RETURNS boolean',
'LANGUAGE sql',
'STABLE',
'SECURITY DEFINER',
'SET search_path = public',
'AS $fn$',
'    SELECT EXISTS (',
'        SELECT 1 FROM public.dispositivos_rep d',
'         WHERE d.id = p_dispositivo_id',
'           AND d.atende_toda_unidade',
'           AND d.unidade_id = p_unidade_id',
'    ) OR EXISTS (',
'        SELECT 1 FROM public.dispositivos_rep_setores ds',
'         WHERE ds.dispositivo_id = p_dispositivo_id',
'           AND ds.setor_id = p_setor_id',
'    );',
'$fn$;',
'',
'COMMENT ON FUNCTION public.fn_dispositivo_atende_setor(uuid, uuid, uuid) IS',
'    \'Fonte unica da abrangencia de um relogio REP: atende a unidade dona inteira (quando \'',
'    \'atende_toda_unidade) mais os setores listados em dispositivos_rep_setores, que podem ser \'',
'    \'de OUTRA unidade. p_unidade_id e a unidade da pessoa/escala.\';',
'',
'-- Armadilha 24: CREATE FUNCTION ja concede EXECUTE a PUBLIC. Sem o REVOKE, anon executa.',
'REVOKE ALL ON FUNCTION public.fn_dispositivo_atende_setor(uuid, uuid, uuid) FROM PUBLIC, anon;',
'GRANT EXECUTE ON FUNCTION public.fn_dispositivo_atende_setor(uuid, uuid, uuid)',
'    TO authenticated, service_role;',
'',
'',
'-- ============================================================================',
'-- 3. fn_ingerir_afd: o setor da marcacao deixa de ser chutado',
'-- ============================================================================',
'-- Corpo copiado de 20260906120000. Mudam 3 trechos, conferidos por contagem pelo gerador:',
'-- a declaracao de v_toda_uni, a leitura da coluna nova, e o IF da derivacao do setor.',
'')

const rodape = L(
'',
'-- Assinatura conferida contra a migration vigente, nao chutada.',
'REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)',
'    FROM PUBLIC, anon, authenticated;',
'GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)',
'    TO service_role;',
'',
'',
'-- ============================================================================',
'-- 4. CONFERENCIA (roda junto, aborta a migration inteira se algo divergir)',
'-- ============================================================================',
'-- Armadilha 42: conferencia que so checa se a funcao EXISTE nao serve - tem que EXECUTAR.',
'-- Confere os DOIS sentidos: a abrangencia nova reproduz a antiga em todo par que existe hoje',
'-- (prova de inercia), E o predicado nao virou "true para tudo".',
'',
'DO $conf$',
'DECLARE',
'    v_div        integer;',
'    v_disp       record;',
'    v_setor      record;',
'    v_ok         boolean;',
'    v_esperado   boolean;',
'    v_pares      integer := 0;',
'    v_verdade    integer := 0;',
'    v_um_setor   integer;',
'BEGIN',
'    -- 4.1 A coluna reproduz a semantica antiga em TODOS os relogios.',
'    SELECT count(*) INTO v_div',
'      FROM public.dispositivos_rep d',
'     WHERE d.atende_toda_unidade',
'       <> NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds',
'                       WHERE ds.dispositivo_id = d.id);',
'    IF v_div > 0 THEN',
'        RAISE EXCEPTION \'ABORTADO: % relogio(s) com atende_toda_unidade divergindo do backfill.\', v_div;',
'    END IF;',
'    RAISE NOTICE \'ok  4.1 backfill coerente com a semantica anterior em todos os relogios\';',
'',
'    -- 4.2 O PREDICADO NOVO devolve o MESMO que a regra antiga, par a par, EXECUTANDO.',
'    --     Regra antiga: unidade da pessoa = unidade do relogio',
'    --                   AND (relogio sem lista OR setor da pessoa na lista)',
'    FOR v_disp IN SELECT id, unidade_id FROM public.dispositivos_rep LOOP',
'        FOR v_setor IN',
'            SELECT s.id AS setor_id, s.unidade_id',
'              FROM public.setores s',
'             WHERE s.unidade_id = v_disp.unidade_id',
'             UNION ALL',
'            SELECT NULL::uuid, v_disp.unidade_id          -- servidor sem setor',
'             UNION ALL',
'            -- O SENTIDO NOVO: setor de OUTRA unidade tem que continuar dando FALSE enquanto',
'            -- ninguem o vinculou. Sem estas linhas a conferencia so exercita o caso antigo.',
'            SELECT s.id, s.unidade_id',
'              FROM public.setores s',
'             WHERE s.unidade_id <> v_disp.unidade_id',
'             LIMIT 5',
'        LOOP',
'            v_ok := public.fn_dispositivo_atende_setor(v_disp.id, v_setor.setor_id, v_setor.unidade_id);',
'            v_esperado := (v_setor.unidade_id = v_disp.unidade_id)',
'                          AND (NOT EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds',
'                                            WHERE ds.dispositivo_id = v_disp.id)',
'                               OR EXISTS (SELECT 1 FROM public.dispositivos_rep_setores ds',
'                                           WHERE ds.dispositivo_id = v_disp.id',
'                                             AND ds.setor_id = v_setor.setor_id));',
'            v_pares := v_pares + 1;',
'            IF v_ok THEN v_verdade := v_verdade + 1; END IF;',
'            IF v_ok <> v_esperado THEN',
'                RAISE EXCEPTION \'ABORTADO: abrangencia mudou para dispositivo % / setor % (novo=%, antigo=%).\',',
'                    v_disp.id, coalesce(v_setor.setor_id::text, \'(sem setor)\'), v_ok, v_esperado;',
'            END IF;',
'        END LOOP;',
'    END LOOP;',
'    RAISE NOTICE \'ok  4.2 predicado identico a regra antiga em % pares (dispositivo, setor), setor de fora incluido\', v_pares;',
'',
'    -- 4.3 O outro sentido: o predicado NAO pode ter virado "sim para tudo".',
'    -- v_pares > 0 e obrigatorio: num banco sem relogio cadastrado (homologacao recem-criada)',
'    -- 0 = 0 abortaria a migration sem haver nada de errado.',
'    IF v_pares > 0 AND v_verdade = v_pares THEN',
'        RAISE EXCEPTION \'ABORTADO: o predicado respondeu VERDADEIRO em todos os % pares - nao esta restringindo nada.\', v_pares;',
'    END IF;',
'    RAISE NOTICE \'ok  4.3 predicado restringe: % de % pares verdadeiros\', v_verdade, v_pares;',
'',
'    -- 4.4 Setor de OUTRA unidade ainda nao e atendido por ninguem (nada foi vinculado aqui).',
'    SELECT count(*) INTO v_div',
'      FROM public.dispositivos_rep_setores ds',
'      JOIN public.dispositivos_rep d ON d.id = ds.dispositivo_id',
'      JOIN public.setores s          ON s.id = ds.setor_id',
'     WHERE s.unidade_id <> d.unidade_id;',
'    RAISE NOTICE \'ok  4.4 vinculos para setor de outra unidade: % (esperado 0 nesta migration)\', v_div;',
'',
'    -- 4.5 A mudanca de fn_ingerir_afd e inerte hoje: nenhum relogio tem exatamente 1 setor.',
'    SELECT count(*) INTO v_um_setor',
'      FROM (SELECT ds.dispositivo_id FROM public.dispositivos_rep_setores ds',
'             GROUP BY ds.dispositivo_id HAVING count(*) = 1) x;',
'    IF v_um_setor > 0 THEN',
'        RAISE NOTICE \'ATENCAO: % relogio(s) com exatamente 1 setor - confira o setor_id das marcacoes deles.\', v_um_setor;',
'    ELSE',
'        RAISE NOTICE \'ok  4.5 nenhum relogio com exatamente 1 setor: o conserto de fn_ingerir_afd e inerte\';',
'    END IF;',
'',
'    -- 4.6 anon nao executa o predicado novo.',
'    IF has_function_privilege(\'anon\', \'public.fn_dispositivo_atende_setor(uuid, uuid, uuid)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: anon continua podendo executar fn_dispositivo_atende_setor.\';',
'    END IF;',
'    IF NOT has_function_privilege(\'authenticated\', \'public.fn_dispositivo_atende_setor(uuid, uuid, uuid)\', \'EXECUTE\') THEN',
'        RAISE EXCEPTION \'ABORTADO: authenticated PERDEU execute em fn_dispositivo_atende_setor.\';',
'    END IF;',
'    RAISE NOTICE \'ok  4.6 privilegios: anon fora, authenticated dentro\';',
'END;',
'$conf$;',
'')

fs.writeFileSync(SAIDA, cabecalho + fn + rodape, 'utf8')
const linhas = fs.readFileSync(SAIDA, 'utf8').split(EOL).length
console.log(`\nescrito: ${path.relative(RAIZ, SAIDA)}  (${linhas} linhas, EOL=${EOL === '\r\n' ? 'CRLF' : 'LF'})`)
