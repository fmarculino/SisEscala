/**
 * Gera 20260917110000_desconsiderar_na_reversao.sql a partir da versao VIGENTE de
 * fn_sincronizar_marcacoes_escala_diaria (20260808070000), substituindo APENAS o bloco
 * "---- REVERSAO ----".
 *
 * Copia mecanica, nunca redigitacao (CLAUDE.md armadilha 1). Aborta se:
 *   - a fonte nao for a vigente (conferida por grep do proprio repositorio);
 *   - o bloco alvo nao aparecer exatamente 1 vez;
 *   - algum invariante do resto da funcao se perder na copia.
 *
 * ⚠️ O EOL e DETECTADO da fonte, nunca assumido (armadilha 59): a convencao do projeto e CRLF,
 * mas ha migrations em LF, e montar o padrao com o EOL errado faz a substituicao virar no-op
 * SILENCIOSO -- o gerador "passa" sem ter trocado nada.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const FONTE = path.join(DIR, '20260808070000_sync_marcacoes_from_escala_diaria.sql')
const SAIDA = path.join(DIR, '20260917110000_desconsiderar_na_reversao.sql')

function abortar(msg) {
  console.error('ABORTADO: ' + msg)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. A fonte e mesmo a versao vigente?
// ---------------------------------------------------------------------------
// A propria saida fica de fora: senao, ao regerar, o gerador acha que a versao vigente e o
// arquivo que ele mesmo escreveu na rodada anterior e aborta.
const definem = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.sql') && f !== path.basename(SAIDA))
  .filter(f => fs.readFileSync(path.join(DIR, f), 'utf8')
    .includes('CREATE OR REPLACE FUNCTION public.fn_sincronizar_marcacoes_escala_diaria'))
  .sort()

if (definem.length === 0) abortar('nenhuma migration define fn_sincronizar_marcacoes_escala_diaria')
const vigente = definem[definem.length - 1]
if (path.basename(FONTE) !== vigente) {
  abortar(`a versao vigente e ${vigente}, nao ${path.basename(FONTE)}. ` +
    'Descubra qual migration define a versao VIGENTE antes de copiar (CLAUDE.md, "Antes de mexer").')
}

const bruto = fs.readFileSync(FONTE, 'utf8')

// ---------------------------------------------------------------------------
// 2. EOL detectado, nunca assumido
// ---------------------------------------------------------------------------
const EOL = bruto.includes('\r\n') ? '\r\n' : '\n'
console.log(`EOL da fonte: ${EOL === '\r\n' ? 'CRLF' : 'LF'}`)

// ---------------------------------------------------------------------------
// 3. Recorta a funcao inteira
// ---------------------------------------------------------------------------
const INI = 'CREATE OR REPLACE FUNCTION public.fn_sincronizar_marcacoes_escala_diaria()'
const FIM = '$fnsync$;'
const iIni = bruto.indexOf(INI)
const iFim = bruto.indexOf(FIM, iIni)
if (iIni < 0 || iFim < 0) abortar('nao achei os delimitadores da funcao na fonte')
let corpo = bruto.slice(iIni, iFim + FIM.length)

// ---------------------------------------------------------------------------
// 4. Substitui SO o bloco de reversao
// ---------------------------------------------------------------------------
const MARCA_INI = '    -- ---- REVERSAO ---------------------------------------------------------'
const MARCA_FIM = '    RETURN NEW;'

const pIni = corpo.indexOf(MARCA_INI)
const pFim = corpo.indexOf(MARCA_FIM, pIni)
if (pIni < 0) abortar('nao achei o marcador "---- REVERSAO" no corpo')
if (pFim < 0) abortar('nao achei o "RETURN NEW;" que fecha o bloco de reversao')

const antigo = corpo.slice(pIni, pFim)

// O bloco antigo precisa ser reconhecivel: se ele ja mudou, esta copia esta desatualizada.
for (const marca of [
  'IF NEW.confirmado_por_id IS NOT NULL OR OLD.confirmado_por_id IS NOT NULL THEN',
  "AND x.tipo = 'desconsiderar')",
  'AND m.ocorrido_em IN (',
]) {
  if (!antigo.includes(marca)) {
    abortar(`o bloco de reversao da fonte nao contem "${marca}" -- ele ja mudou, reveja a copia`)
  }
}

const L = (s) => s
const novo = [
  L('    -- ---- REVERSAO ---------------------------------------------------------'),
  L('    -- fn_reverter_presenca_manual zera o passo em escala_diaria. Sem tratar isso, a marcacao'),
  L('    -- correspondente continuaria valendo e a reconciliacao a traria de volta.'),
  L('    -- A marcacao NAO e apagada (a tabela e imutavel): registra-se um tratamento'),
  L("    -- 'desconsiderar', que e exatamente o mecanismo previsto para isso."),
  L('    --'),
  L('    -- ===================================================================================='),
  L('    -- TRES CORRECOES DE 20260917110000 (defeito D3 do plano de 17/09/2026)'),
  L('    -- ===================================================================================='),
  L('    --'),
  L('    -- 1. O INSERT vivia sob `IF NEW.confirmado_por_id IS NOT NULL OR OLD... IS NOT NULL`.'),
  L('    --    Batida de relogio nunca validada a mao tem confirmado_por_id NULO -- medido em'),
  L('    --    17/09/2026: 4.471 de 11.242 linhas com saida de origem `rep` (39,8%). Nessas, o'),
  L('    --    tratamento NAO era gravado e a batida voltava na proxima reconciliacao: a reversao'),
  L('    --    parecia funcionar na tela e nao durava, sem erro em lugar nenhum.'),
  L('    --    A raiz foi fechada na 20260917100000 (fn_reverter_presenca_manual passou a gravar'),
  L('    --    p_validador_id em confirmado_por_id, que antes era recebido e descartado); aqui o'),
  L('    --    autor ainda cai para auth.uid() e, por fim, para quem registrou a propria marcacao.'),
  L('    --    So quando NENHUM desses existe o tratamento deixa de ser gravado -- e ai com'),
  L('    --    RAISE WARNING nomeando a marcacao, nunca em silencio.'),
  L('    --'),
  L('    -- 2. O alvo era casado por (servidor, ocorrido_em), o que alcanca QUALQUER marcacao do'),
  L('    --    servidor naquele instante, de qualquer origem e de qualquer dispositivo. Agora o'),
  L('    --    presenca_*_marcacao_id de OLD manda quando existe; o casamento por instante fica'),
  L('    --    como fallback para o historico anterior a 20260808020000, quando a coluna nasceu.'),
  L('    --'),
  L("    -- 3. `NOT EXISTS (tipo = 'desconsiderar')` impedia regravar depois de um 'restaurar':"),
  L('    --    o par deixava de alternar e a segunda reversao da mesma marcacao nao produzia'),
  L('    --    efeito. O criterio passa a ser o ULTIMO tratamento por created_at -- a mesma regra'),
  L('    --    que fn_alocar_marcacoes_dia aplica para decidir o que vale, agora com fonte unica'),
  L('    --    em fn_marcacao_desconsiderada.'),
  L("    IF TG_OP = 'UPDATE' THEN"),
  L('        v_autor := COALESCE(NEW.confirmado_por_id, OLD.confirmado_por_id, auth.uid());'),
  L(''),
  L('        FOR v_alvo IN'),
  L('            WITH revertidos (marcacao_id, ocorrido_em) AS ('),
  L('                VALUES'),
  L('                    ((CASE WHEN NEW.presenca_entrada_em           IS NULL THEN OLD.presenca_entrada_marcacao_id           END)::uuid,'),
  L('                     (CASE WHEN NEW.presenca_entrada_em           IS NULL THEN OLD.presenca_entrada_em                    END)::timestamptz),'),
  L('                    ((CASE WHEN NEW.presenca_intervalo_saida_em   IS NULL THEN OLD.presenca_intervalo_saida_marcacao_id   END)::uuid,'),
  L('                     (CASE WHEN NEW.presenca_intervalo_saida_em   IS NULL THEN OLD.presenca_intervalo_saida_em            END)::timestamptz),'),
  L('                    ((CASE WHEN NEW.presenca_intervalo_retorno_em IS NULL THEN OLD.presenca_intervalo_retorno_marcacao_id END)::uuid,'),
  L('                     (CASE WHEN NEW.presenca_intervalo_retorno_em IS NULL THEN OLD.presenca_intervalo_retorno_em          END)::timestamptz),'),
  L('                    ((CASE WHEN NEW.presenca_saida_em             IS NULL THEN OLD.presenca_saida_marcacao_id             END)::uuid,'),
  L('                     (CASE WHEN NEW.presenca_saida_em             IS NULL THEN OLD.presenca_saida_em                      END)::timestamptz)'),
  L('            )'),
  L('            SELECT DISTINCT m.id'),
  L('              FROM revertidos r'),
  L('              JOIN public.marcacoes_ponto m'),
  L('                ON (r.marcacao_id IS NOT NULL AND m.id = r.marcacao_id)'),
  L('                OR (r.marcacao_id IS NULL'),
  L('                    AND m.servidor_id = v_servidor_id'),
  L('                    AND m.ocorrido_em = r.ocorrido_em)'),
  L('             WHERE r.ocorrido_em IS NOT NULL'),
  L('               AND NOT public.fn_marcacao_desconsiderada(m.id)'),
  L('        LOOP'),
  L('            IF v_autor IS NULL THEN'),
  L('                SELECT COALESCE(m.registrado_por_id, m.coordenador_id) INTO v_autor'),
  L('                  FROM public.marcacoes_ponto m WHERE m.id = v_alvo;'),
  L('            END IF;'),
  L(''),
  L('            IF v_autor IS NULL THEN'),
  L('                -- marcacoes_tratamentos.registrado_por_id e NOT NULL: sem autor nao ha o que'),
  L('                -- gravar. Antes isto era um IF mudo; agora deixa rastro no log, porque o'),
  L('                -- efeito (a batida voltar na proxima reconciliacao) e invisivel na tela.'),
  // ⚠️ Literal em UMA linha: RAISE exige string literal (concatenar da 42601, armadilha da
  // 20260911xxxx), e quebrar o literal em varias linhas do arquivo mete CR dentro da mensagem.
  L("                RAISE WARNING 'reversao sem autor: tratamento desconsiderar NAO gravado para a marcacao %, e a batida voltara na proxima reconciliacao (escala_diaria %)', v_alvo, NEW.id;"),
  L('            ELSE'),
  L('                INSERT INTO public.marcacoes_tratamentos'),
  L('                    (marcacao_id, tipo, justificativa, registrado_por_id)'),
  L("                VALUES (v_alvo, 'desconsiderar',"),
  L("                        'Presenca revertida em escala_diaria (sincronizacao automatica).',"),
  L('                        v_autor);'),
  L('            END IF;'),
  L('        END LOOP;'),
  L('    END IF;'),
  L(''),
].join(EOL)

corpo = corpo.slice(0, pIni) + novo + corpo.slice(pFim)

// A variavel v_autor e nova: precisa ser DECLARADA. Sem isso o CREATE e RECUSADO na hora
// (42601, "v_autor is not a known variable") -- o unico erro de plpgsql que o Postgres pega no
// CREATE em vez de na execucao (CLAUDE.md armadilha 1).
const DECL = '    v_alvo        uuid;'
if (corpo.split(DECL).length - 1 !== 1) abortar('nao achei a declaracao de v_alvo para ancorar v_autor')
corpo = corpo.replace(DECL, DECL + EOL + '    v_autor       uuid;')

// ---------------------------------------------------------------------------
// 5. Invariantes: o RESTO da funcao tem de ter sobrevivido intacto
// ---------------------------------------------------------------------------
const INVARIANTES = [
  ["guard anti-eco da reconciliacao", "IF COALESCE(current_setting('sisescala.reconciliacao', true), 'off') = 'on' THEN"],
  ["saida rapida de UPDATE sem presenca", 'IS NOT DISTINCT FROM OLD.presenca_saida_em THEN'],
  ["os 4 passos ainda sincronizam", null],
  ["EXCEPTION que nunca trava a batida", 'RAISE WARNING \'fn_sincronizar_marcacoes_escala_diaria falhou'],
  ["v_autor declarado", '    v_autor       uuid;'],
]
for (const [nome, marca] of INVARIANTES) {
  if (marca && !corpo.includes(marca)) abortar(`invariante perdido na copia: ${nome}`)
}
const passos = (corpo.match(/public\.fn_registrar_marcacao\(/g) || []).length
if (passos !== 4) abortar(`esperava 4 chamadas a fn_registrar_marcacao (um por passo), achei ${passos}`)

// E o bloco antigo nao pode ter sobrado em lugar nenhum
for (const proibido of [
  'IF NEW.confirmado_por_id IS NOT NULL OR OLD.confirmado_por_id IS NOT NULL THEN',
  'AND m.ocorrido_em IN (',
]) {
  if (corpo.includes(proibido)) abortar(`o bloco antigo sobreviveu a substituicao: "${proibido}"`)
}

// ---------------------------------------------------------------------------
// 6. Monta a migration
// ---------------------------------------------------------------------------
const cabecalho = [
  '-- Migration: O desconsiderar da reversao deixa de depender de confirmado_por_id',
  '-- Data: 2026-09-17',
  '-- Plano: docs/planos/2026-09-17-correcao-de-batida-real-pelo-rh-e-falta-em-plantao.md (defeito D3)',
  '-- Gerada por scratchpad/gen_desconsiderar_reversao.js a partir de',
  '--   20260808070000_sync_marcacoes_from_escala_diaria.sql (copia mecanica, armadilha 1).',
  '--   NAO EDITAR A MAO: regenere pelo script, que aborta se a fonte divergir.',
  '--',
  '-- O QUE ESTAVA ERRADO',
  '--   A reversao de um passo em escala_diaria so e DURAVEL porque este trigger grava um',
  "--   tratamento 'desconsiderar' sobre a marcacao -- sem ele, fn_alocar_marcacoes_dia torna a",
  '--   ver a batida e a proxima reconciliacao a repoe no passo. O INSERT vivia sob um IF que',
  '--   exigia confirmado_por_id preenchido, e batida de relogio nunca validada a mao nao tem.',
  '--',
  '--   Medido em producao em 17/09/2026: 4.471 de 11.242 linhas (39,8%) com saida de origem',
  '--   `rep` estao com confirmado_por_id NULO. Nelas, reverter era um no-op de efeito atrasado:',
  '--   a tela mostrava o passo vazio e a batida voltava sozinha depois.',
  '--',
  '-- ORDEM DE APLICACAO',
  '--   Depende de 20260917100000 (que faz fn_reverter_presenca_manual gravar o autor). Aplicar',
  '--   esta sozinha melhora o caso, mas deixa a autoria dependendo de auth.uid().',
  '',
  '',
  '-- ============================================================================',
  "-- 0. O 'ULTIMO TRATAMENTO' PRECISA EXISTIR: now() NAO DESEMPATA",
  '-- ============================================================================',
  '-- 🚨 Achado pelo PROPRIO ensaio desta migration, nao por leitura de codigo.',
  '--',
  '--   marcacoes_tratamentos.created_at tinha DEFAULT now(), que e o instante de inicio da',
  '--   TRANSACAO, nao do comando. Dois tratamentos da mesma marcacao gravados na mesma',
  "--   transacao ficam com created_at IDENTICO -- e ai nao existe 'ultimo'. Como o predicado",
  "--   procura um 'desconsiderar' entre os empatados, o desconsiderar vence SEMPRE: gravar",
  "--   'restaurar' logo depois de 'desconsiderar' nao produzia efeito nenhum.",
  '--',
  '--   clock_timestamp() avanca dentro da transacao e resolve na origem. Vale so para linhas',
  '--   NOVAS -- e conferido em producao em 17/09/2026 que nao ha empate no historico: 2.795',
  '--   tratamentos, 6 restaurar, ZERO pares (marcacao, created_at) repetidos.',
  '--',
  '-- ⚠️ Mudar o DEFAULT nao reescreve nada e nao tranca tabela: e so catalogo.',
  '',
  'ALTER TABLE public.marcacoes_tratamentos',
  '    ALTER COLUMN created_at SET DEFAULT clock_timestamp();',
  '',
  '',
  '-- ============================================================================',
  '-- 1. FONTE UNICA: a marcacao esta desconsiderada AGORA?',
  '-- ============================================================================',
  '-- O efetivo e o ULTIMO tratamento por created_at, porque desconsiderar/restaurar se alternam.',
  '--',
  '-- ⚠️ fn_alocar_marcacoes_dia tem o MESMO predicado escrito inline, dentro do cursor que monta',
  '--    as candidatas, e NAO foi trocado por esta funcao de proposito: ali ele roda por marcacao',
  '--    dentro de uma consulta quente, e trocar um NOT EXISTS correlacionado por chamada de',
  '--    funcao muda o plano de execucao de um caminho critico. Ao alterar a REGRA, altere os',
  '--    dois -- o gerador da alocacao confere que o predicado inline continua presente.',
  '',
  'CREATE OR REPLACE FUNCTION public.fn_marcacao_desconsiderada(p_marcacao_id uuid)',
  'RETURNS boolean',
  'LANGUAGE sql',
  'STABLE',
  'SET search_path = public',
  'AS $fn$',
  '    SELECT EXISTS (',
  '        SELECT 1',
  '          FROM public.marcacoes_tratamentos t',
  '         WHERE t.marcacao_id = p_marcacao_id',
  "           AND t.tipo IN ('desconsiderar', 'restaurar')",
  '           AND t.created_at = (',
  '               SELECT max(t2.created_at)',
  '                 FROM public.marcacoes_tratamentos t2',
  '                WHERE t2.marcacao_id = p_marcacao_id',
  "                  AND t2.tipo IN ('desconsiderar', 'restaurar'))",
  "           AND t.tipo = 'desconsiderar'",
  '    );',
  '$fn$;',
  '',
  'COMMENT ON FUNCTION public.fn_marcacao_desconsiderada(uuid) IS',
  "    'True quando o ULTIMO tratamento desconsiderar/restaurar da marcacao e um desconsiderar. '",
  "    'Espelho do predicado inline de fn_alocar_marcacoes_dia -- ao mudar a regra, mude os dois.';",
  '',
  'REVOKE ALL ON FUNCTION public.fn_marcacao_desconsiderada(uuid) FROM PUBLIC, anon;',
  'GRANT EXECUTE ON FUNCTION public.fn_marcacao_desconsiderada(uuid) TO authenticated, service_role;',
  '',
  '',
  '-- ============================================================================',
  '-- 2. O TRIGGER (copia mecanica, so o bloco de reversao mudou)',
  '-- ============================================================================',
  '',
].join(EOL)

const conferencia = [
  '',
  '',
  '-- ============================================================================',
  '-- CONFERENCIA -- EXECUTA o caminho, nao apenas confere que a funcao existe (armadilha 42)',
  '-- ============================================================================',
  '-- Ensaio sintetico revertido por RAISE EXCEPTION, nos DOIS sentidos:',
  '--   (a) reverter um passo cuja linha tem confirmado_por_id NULO passa a gravar o tratamento',
  '--       -- era exatamente o caso que nao gravava;',
  "--   (b) marcacao cujo ULTIMO tratamento e 'restaurar' volta a poder ser desconsiderada",
  '--       -- era o que o NOT EXISTS antigo impedia para sempre.',
  '',
  'DO $conf$',
  'DECLARE',
  '    v_ed      record;',
  '    v_marc    uuid;',
  '    v_autor   uuid;',
  '    v_n       integer;',
  'BEGIN',
  '    SELECT p.id INTO v_autor FROM public.profiles p LIMIT 1;',
  '    IF v_autor IS NULL THEN',
  "        RAISE NOTICE 'CONFERENCIA 20260917110000: sem profiles; nada a exercitar.';",
  '        RETURN;',
  '    END IF;',
  '',
  '    -- (b) primeiro, porque nao depende de escala nenhuma.',
  '    SELECT m.id INTO v_marc FROM public.marcacoes_ponto m',
  '     WHERE NOT EXISTS (SELECT 1 FROM public.marcacoes_tratamentos t WHERE t.marcacao_id = m.id)',
  '     LIMIT 1;',
  '',
  '    IF v_marc IS NOT NULL THEN',
  '        INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)',
  "        VALUES (v_marc, 'desconsiderar', 'ensaio da migration 20260917110000', v_autor);",
  '        IF NOT public.fn_marcacao_desconsiderada(v_marc) THEN',
  "            RAISE EXCEPTION 'CONFERENCIA FALHOU: desconsiderar nao foi reconhecido (marcacao %)', v_marc;",
  '        END IF;',
  '',
  '        INSERT INTO public.marcacoes_tratamentos (marcacao_id, tipo, justificativa, registrado_por_id)',
  "        VALUES (v_marc, 'restaurar', 'ensaio da migration 20260917110000', v_autor);",
  '        IF public.fn_marcacao_desconsiderada(v_marc) THEN',
  "            RAISE EXCEPTION 'CONFERENCIA FALHOU: restaurar nao desfez o desconsiderar (marcacao %)', v_marc;",
  '        END IF;',
  '    END IF;',
  '',
  '    -- (a) o caso que motivou: linha com batida e confirmado_por_id NULO.',
  '    SELECT ed.id, ed.escala_mensal_id, ed.dia, ed.categoria::text AS categoria,',
  '           ed.presenca_saida_em, ed.presenca_saida_marcacao_id',
  '      INTO v_ed',
  '      FROM public.escala_diaria ed',
  '      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id',
  '     WHERE ed.presenca_saida_em IS NOT NULL',
  '       AND ed.presenca_saida_marcacao_id IS NOT NULL',
  '       AND ed.confirmado_por_id IS NULL',
  "       AND ed.categoria::text <> 'Sobreaviso'",
  '       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)',
  '       AND NOT public.fn_marcacao_desconsiderada(ed.presenca_saida_marcacao_id)',
  '     LIMIT 1;',
  '',
  '    IF v_ed.id IS NULL THEN',
  "        RAISE NOTICE 'CONFERENCIA 20260917110000: nenhuma linha com confirmado_por_id nulo; (a) nao exercitado.';",
  "        RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';",
  '    END IF;',
  '',
  '    PERFORM public.fn_reverter_presenca_manual(',
  "        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor);",
  '',
  '    SELECT count(*) INTO v_n',
  '      FROM public.marcacoes_tratamentos t',
  '     WHERE t.marcacao_id = v_ed.presenca_saida_marcacao_id',
  "       AND t.tipo = 'desconsiderar';",
  '',
  '    IF v_n = 0 THEN',
  "        RAISE EXCEPTION 'CONFERENCIA FALHOU: reverter linha com confirmado_por_id NULO nao gravou o tratamento (marcacao %)', v_ed.presenca_saida_marcacao_id;",
  '    END IF;',
  '',
  "    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';",
  'EXCEPTION',
  '    WHEN OTHERS THEN',
  "        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN",
  "            RAISE NOTICE 'CONFERENCIA 20260917110000: OK (ensaio revertido).';",
  '        ELSE',
  '            RAISE;',
  '        END IF;',
  'END;',
  '$conf$;',
  '',
].join(EOL)

fs.writeFileSync(SAIDA, cabecalho + corpo + conferencia, 'utf8')
console.log('escrito: ' + path.basename(SAIDA))
console.log('  fonte vigente conferida: ' + vigente)
console.log('  invariantes: ' + INVARIANTES.length + ' ok, 4 chamadas a fn_registrar_marcacao preservadas')
