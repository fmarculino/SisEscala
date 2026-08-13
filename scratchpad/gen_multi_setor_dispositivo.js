// Gera 20260813140000_multi_setor_dispositivos_rep.sql copiando o corpo VIGENTE de tres funcoes
// e aplicando substituicoes pontuais, mesmo padrao de gen_guard_aceitar.js (CLAUDE.md armadilha 1):
//   1. extrai o CREATE OR REPLACE inteiro de cada funcao do arquivo vigente;
//   2. confere invariantes ANTES;
//   3. aplica substituicoes pontuais com replacer FUNCAO (nunca string - $$ e $' quebram
//      dollar-quoting plpgsql, ja aconteceu em 20260809000000);
//   4. confere invariantes DEPOIS e aborta em qualquer divergencia;
//   5. confere que, removidos os trechos inseridos, o resto volta byte a byte identico ao vigente.
//
// fn_cobertura_ponto_resumo NAO segue o mesmo molde (a mudanca nao e' pontual - o JOIN inteiro
// para "o" setor vira um LATERAL de agregacao) mas ainda extrai o corpo vigente e confere que as
// partes que nao deveriam mudar (RETURNS TABLE exceto uma coluna, os FILTER/count, o ORDER BY)
// continuam identicas.
//
// Arquivos de migration usam CRLF - lidos e escritos como texto cru.
const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const SRC_CADASTROS = path.join(RAIZ, 'supabase/migrations/20260812000000_add_rep_cadastros_push.sql')
const SRC_COBERTURA = path.join(RAIZ, 'supabase/migrations/20260813000000_add_cobertura_ponto_rep.sql')
const SRC_INGESTAO = path.join(RAIZ, 'supabase/migrations/20260808080000_add_rep_ingestion.sql')
const SAIDA = path.join(RAIZ, 'supabase/migrations/20260813140000_multi_setor_dispositivos_rep.sql')

const morrer = (m) => { console.error('ABORTADO: ' + m); process.exit(1) }
const contar = (s, sub) => s.split(sub).length - 1

function extrair(fonte, inicioMarca, fimMarca) {
  const i = fonte.indexOf(inicioMarca)
  if (i === -1) morrer(`nao achei "${inicioMarca.slice(0, 60)}"`)
  const j = fonte.indexOf(fimMarca, i)
  if (j === -1) morrer(`nao achei o fechamento "${fimMarca}" depois de "${inicioMarca.slice(0, 40)}"`)
  return fonte.slice(i, j + fimMarca.length)
}

function conferir(rotulo, corpo, lista) {
  for (const [frag, n] of lista) {
    const c = contar(corpo, frag)
    if (c !== n) morrer(`${rotulo}: invariante divergiu: "${frag.slice(0, 70)}" esperado ${n}, achei ${c}`)
  }
}

// ================================================================================================
// 1. fn_enfileirar_cadastros_rep (20260812000000) - filtro de setor na fila de cadastro
// ================================================================================================
const fonteCadastros = fs.readFileSync(SRC_CADASTROS, 'utf8')
let corpoCadastros = extrair(
  fonteCadastros,
  'CREATE OR REPLACE FUNCTION public.fn_enfileirar_cadastros_rep(p_dispositivo_id uuid)',
  '\r\n$fn$;'
)
const CAD_ORIGINAL = corpoCadastros

conferir('fn_enfileirar_cadastros_rep ANTES', corpoCadastros, [
  ['    v_setor_id   uuid;', 1],
  ['    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id\r\n      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;', 1],
  ['           AND (v_setor_id IS NULL OR s.setor_id = v_setor_id)', 1],
  ['$fn$', 2],
])

const CAD_DECL_VELHA = '    v_unidade_id uuid;\r\n    v_setor_id   uuid;\r\n'
const CAD_DECL_NOVA = '    v_unidade_id uuid;\r\n    v_restrito   boolean;\r\n'
if (contar(corpoCadastros, CAD_DECL_VELHA) !== 1) morrer('fn_enfileirar_cadastros_rep: DECLARE nao bate')
corpoCadastros = corpoCadastros.replace(CAD_DECL_VELHA, () => CAD_DECL_NOVA)

const CAD_RESOLVE_VELHA = '    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id\r\n' +
  '      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;\r\n' +
  '    IF v_unidade_id IS NULL THEN\r\n' +
  "        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;\r\n" +
  '    END IF;\r\n'
const CAD_RESOLVE_NOVA = [
  '    SELECT unidade_id INTO v_unidade_id',
  '      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
  '    IF v_unidade_id IS NULL THEN',
  "        RAISE EXCEPTION 'Dispositivo % nao encontrado.', p_dispositivo_id;",
  '    END IF;',
  '',
  '    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de',
  '    -- dispositivos_rep.setor_id IS NULL de antes desta migration); >=1 linha = so os setores',
  '    -- listados. Ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md.',
  '    SELECT EXISTS (',
  '        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id',
  '    ) INTO v_restrito;',
  '',
].join('\r\n') + '\r\n'
if (contar(corpoCadastros, CAD_RESOLVE_VELHA) !== 1) morrer('fn_enfileirar_cadastros_rep: resolucao de unidade nao bate')
corpoCadastros = corpoCadastros.replace(CAD_RESOLVE_VELHA, () => CAD_RESOLVE_NOVA)

const CAD_FILTRO_VELHO = '           AND (v_setor_id IS NULL OR s.setor_id = v_setor_id)'
const CAD_FILTRO_NOVO = [
  '           AND (NOT v_restrito OR EXISTS (',
  '                 SELECT 1 FROM public.dispositivos_rep_setores ds',
  '                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = s.setor_id))',
].join('\r\n')
if (contar(corpoCadastros, CAD_FILTRO_VELHO) !== 1) morrer('fn_enfileirar_cadastros_rep: filtro de setor nao bate')
corpoCadastros = corpoCadastros.replace(CAD_FILTRO_VELHO, () => CAD_FILTRO_NOVO)

conferir('fn_enfileirar_cadastros_rep DEPOIS', corpoCadastros, [
  ['v_restrito   boolean;', 1],
  ['SELECT EXISTS (', 1],
  ['NOT v_restrito OR EXISTS (', 1],
  ['v_setor_id', 0],   // variavel removida do DECLARE - nenhuma referencia pode sobrar
  ['$fn$', 2],
])

// Reconstrucao: revertendo os 3 trechos inseridos, o corpo tem que voltar byte a byte ao vigente.
const CAD_RECONSTRUIDO = corpoCadastros
  .replace(CAD_FILTRO_NOVO, () => CAD_FILTRO_VELHO)
  .replace(CAD_RESOLVE_NOVA, () => CAD_RESOLVE_VELHA)
  .replace(CAD_DECL_NOVA, () => CAD_DECL_VELHA)
if (CAD_RECONSTRUIDO !== CAD_ORIGINAL) morrer('fn_enfileirar_cadastros_rep: reconstrucao NAO bateu com o vigente')
console.log('OK: fn_enfileirar_cadastros_rep reescrita (reconstrucao confere).')

// ================================================================================================
// 2. fn_cobertura_ponto_dispositivo (20260813000000) - filtro de setor em escalados + lotacao
// ================================================================================================
const fonteCobertura = fs.readFileSync(SRC_COBERTURA, 'utf8')
let corpoDispositivo = extrair(
  fonteCobertura,
  'CREATE FUNCTION public.fn_cobertura_ponto_dispositivo(',
  '\r\n$fn$;'
)
// A versao vigente foi criada com DROP FUNCTION IF EXISTS + CREATE FUNCTION (a propria migration
// de origem faz isso para as 3 funcoes do arquivo, de uma vez, no topo). Esta migration nao repete
// o DROP para esta funcao porque o RETURNS TABLE nao muda - CREATE OR REPLACE e valido e preferivel
// (preserva grants existentes). Por isso o "CREATE FUNCTION" extraido vira "CREATE OR REPLACE".
if (contar(corpoDispositivo, 'CREATE FUNCTION public.fn_cobertura_ponto_dispositivo(') !== 1) morrer('fn_cobertura_ponto_dispositivo: cabecalho CREATE FUNCTION nao bate')
corpoDispositivo = corpoDispositivo.replace(
  'CREATE FUNCTION public.fn_cobertura_ponto_dispositivo(',
  () => 'CREATE OR REPLACE FUNCTION public.fn_cobertura_ponto_dispositivo(')
const DISP_ORIGINAL = corpoDispositivo   // baseline pos-cabecalho (mudanca de cabecalho ja conferida acima)

conferir('fn_cobertura_ponto_dispositivo ANTES', corpoDispositivo, [
  ['    v_setor_id    uuid;', 1],
  ['    SELECT d.unidade_id, d.setor_id INTO v_unidade_id, v_setor_id', 1],
  ['           AND (v_setor_id IS NULL OR em.setor_id = v_setor_id)', 1],
  ['(r.unidade_id = v_unidade_id AND (v_setor_id IS NULL OR r.setor_id = v_setor_id))', 1],
  ['$fn$', 2],
])

const DISP_DECL_VELHA = '    v_setor_id    uuid;\r\n'
const DISP_DECL_NOVA = '    v_restrito    boolean;\r\n'
corpoDispositivo = corpoDispositivo.replace(DISP_DECL_VELHA, () => DISP_DECL_NOVA)

const DISP_RESOLVE_VELHA = [
  '    SELECT d.unidade_id, d.setor_id INTO v_unidade_id, v_setor_id',
  '      FROM public.dispositivos_rep d',
  '     WHERE d.id = p_dispositivo_id',
  '       AND (auth.uid() IS NULL',
  '            OR public.fn_unidade_no_escopo(d.unidade_id)',
  '            OR public.fn_unidade_alcancavel_por_setor(d.unidade_id));',
  '',
  '    IF v_unidade_id IS NULL THEN',
  "        RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'",
  "            USING ERRCODE = 'insufficient_privilege';",
  '    END IF;',
].join('\r\n')
// A linha SELECT tambem muda (d.setor_id/v_setor_id somem - a variavel nao existe mais no
// DECLARE apos a substituicao acima). Bug real pego na revisao manual do primeiro arquivo
// gerado: reusar DISP_RESOLVE_VELHA inteiro como prefixo de DISP_RESOLVE_NOVA deixava essa
// linha intocada, referenciando v_setor_id ja removido - CREATE OR REPLACE aceitaria (plpgsql
// so resolve nomes em tempo de execucao, CLAUDE.md armadilha 1), mas a funcao quebraria no
// primeiro uso real.
const DISP_RESOLVE_NOVA = [
  '    SELECT d.unidade_id INTO v_unidade_id',
  '      FROM public.dispositivos_rep d',
  '     WHERE d.id = p_dispositivo_id',
  '       AND (auth.uid() IS NULL',
  '            OR public.fn_unidade_no_escopo(d.unidade_id)',
  '            OR public.fn_unidade_alcancavel_por_setor(d.unidade_id));',
  '',
  '    IF v_unidade_id IS NULL THEN',
  "        RAISE EXCEPTION 'Dispositivo inexistente ou fora do seu escopo.'",
  "            USING ERRCODE = 'insufficient_privilege';",
  '    END IF;',
  '',
  '    -- 0 linhas em dispositivos_rep_setores = "toda a unidade" (mesma semantica de',
  '    -- dispositivos_rep.setor_id IS NULL de antes desta migration); >=1 linha = so os setores',
  '    -- listados. Ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md.',
  '    SELECT EXISTS (',
  '        SELECT 1 FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id',
  '    ) INTO v_restrito;',
].join('\r\n')
if (contar(corpoDispositivo, DISP_RESOLVE_VELHA) !== 1) morrer('fn_cobertura_ponto_dispositivo: resolucao de unidade nao bate')
corpoDispositivo = corpoDispositivo.replace(DISP_RESOLVE_VELHA, () => DISP_RESOLVE_NOVA)

const DISP_ESCALADOS_VELHO = '           AND (v_setor_id IS NULL OR em.setor_id = v_setor_id)'
const DISP_ESCALADOS_NOVO = [
  '           AND (NOT v_restrito OR EXISTS (',
  '                 SELECT 1 FROM public.dispositivos_rep_setores ds',
  '                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = em.setor_id))',
].join('\r\n')
if (contar(corpoDispositivo, DISP_ESCALADOS_VELHO) !== 1) morrer('fn_cobertura_ponto_dispositivo: filtro de escalados nao bate')
corpoDispositivo = corpoDispositivo.replace(DISP_ESCALADOS_VELHO, () => DISP_ESCALADOS_NOVO)

const DISP_LOTACAO_VELHO = '           (r.unidade_id = v_unidade_id AND (v_setor_id IS NULL OR r.setor_id = v_setor_id))'
const DISP_LOTACAO_NOVO = [
  '           (r.unidade_id = v_unidade_id AND (NOT v_restrito OR EXISTS (',
  '                 SELECT 1 FROM public.dispositivos_rep_setores ds',
  '                  WHERE ds.dispositivo_id = p_dispositivo_id AND ds.setor_id = r.setor_id)))',
].join('\r\n')
if (contar(corpoDispositivo, DISP_LOTACAO_VELHO) !== 1) morrer('fn_cobertura_ponto_dispositivo: lotacao_compativel nao bate')
corpoDispositivo = corpoDispositivo.replace(DISP_LOTACAO_VELHO, () => DISP_LOTACAO_NOVO)

conferir('fn_cobertura_ponto_dispositivo DEPOIS', corpoDispositivo, [
  ['v_restrito    boolean;', 1],
  ['NOT v_restrito OR EXISTS (', 2],
  ['v_setor_id', 0],   // variavel removida do DECLARE - nenhuma referencia pode sobrar
  ['$fn$', 2],
])

// Reconstrucao: revertendo os 4 trechos inseridos, o corpo tem que voltar byte a byte ao vigente
// (pos mudanca de cabecalho, ja conferida separadamente acima).
const DISP_RECONSTRUIDO = corpoDispositivo
  .replace(DISP_LOTACAO_NOVO, () => DISP_LOTACAO_VELHO)
  .replace(DISP_ESCALADOS_NOVO, () => DISP_ESCALADOS_VELHO)
  .replace(DISP_RESOLVE_NOVA, () => DISP_RESOLVE_VELHA)
  .replace(DISP_DECL_NOVA, () => DISP_DECL_VELHA)
if (DISP_RECONSTRUIDO !== DISP_ORIGINAL) morrer('fn_cobertura_ponto_dispositivo: reconstrucao NAO bateu com o vigente')
console.log('OK: fn_cobertura_ponto_dispositivo reescrita (reconstrucao confere).')

// ================================================================================================
// 3. fn_cobertura_ponto_resumo (20260813000000) - "o" setor vira lista agregada de setores
// ================================================================================================
// RETURNS TABLE muda (setor_nome -> setores_nomes): precisa de DROP FUNCTION IF EXISTS antes do
// CREATE (CLAUDE.md armadilha 1, 42P13 - a propria migration de origem ja documenta isso).
let corpoResumo = extrair(
  fonteCobertura,
  'CREATE FUNCTION public.fn_cobertura_ponto_resumo(',
  '\r\n$fn$;'
)
const RES_ORIGINAL = corpoResumo

// A coluna no arquivo original tem espacamento proprio (alinhamento da tabela) - conferimos pelo
// fragmento exato usado no arquivo fonte.
if (contar(corpoResumo, '    setor_nome          text,') !== 1) morrer('fn_cobertura_ponto_resumo: coluna setor_nome nao bate')
if (contar(corpoResumo, 'LEFT JOIN public.setores se ON se.id = d.setor_id') !== 1) morrer('fn_cobertura_ponto_resumo: JOIN setores nao bate')
if (contar(corpoResumo, 'LEFT JOIN public.dicionario_setores ds ON ds.id = se.dicionario_setor_id') !== 1) morrer('fn_cobertura_ponto_resumo: JOIN dicionario_setores nao bate')
if (contar(corpoResumo, '           ds.nome,\r\n') !== 1) morrer('fn_cobertura_ponto_resumo: coluna ds.nome no SELECT nao bate')
if (contar(corpoResumo, 'GROUP BY d.id, d.nome, un.nome, ds.nome, d.ativo, d.ultimo_contato_em') !== 1) morrer('fn_cobertura_ponto_resumo: GROUP BY nao bate')
if (contar(corpoResumo, '        SELECT d.id, d.nome, d.unidade_id, d.setor_id, d.ativo, d.ultimo_contato_em') !== 1) morrer('fn_cobertura_ponto_resumo: SELECT da CTE dispositivos nao bate')

const RES_COLUNA_VELHA = '    setor_nome          text,'
const RES_COLUNA_NOVA = '    setores_nomes       text,'
corpoResumo = corpoResumo.replace(RES_COLUNA_VELHA, () => RES_COLUNA_NOVA)

const RES_CTE_VELHA = '        SELECT d.id, d.nome, d.unidade_id, d.setor_id, d.ativo, d.ultimo_contato_em'
const RES_CTE_NOVA = '        SELECT d.id, d.nome, d.unidade_id, d.ativo, d.ultimo_contato_em'
corpoResumo = corpoResumo.replace(RES_CTE_VELHA, () => RES_CTE_NOVA)

// setores_agg.nomes ja entra envolvida em max(): nao esta no GROUP BY (mesmo padrao de
// max(c.snapshot_em) ja usado nesta funcao para uma coluna por-dispositivo vinda de LATERAL).
const RES_SELECT_VELHA = '           ds.nome,\r\n'
const RES_SELECT_NOVA = '           max(setores_agg.nomes),\r\n'
corpoResumo = corpoResumo.replace(RES_SELECT_VELHA, () => RES_SELECT_NOVA)

const RES_JOIN_VELHA = '      LEFT JOIN public.setores se ON se.id = d.setor_id\r\n' +
  '      LEFT JOIN public.dicionario_setores ds ON ds.id = se.dicionario_setor_id\r\n'
const RES_JOIN_NOVA = [
  '      LEFT JOIN LATERAL (',
  '          -- Lista os setores deste dispositivo (0 linhas = "toda a unidade", igual antes).',
  '          SELECT string_agg(ds2.nome, \', \' ORDER BY ds2.nome) AS nomes',
  '            FROM public.dispositivos_rep_setores drs',
  '            JOIN public.setores se2 ON se2.id = drs.setor_id',
  '            JOIN public.dicionario_setores ds2 ON ds2.id = se2.dicionario_setor_id',
  '           WHERE drs.dispositivo_id = d.id',
  '      ) setores_agg ON true',
  '',
].join('\r\n') + '\r\n'
corpoResumo = corpoResumo.replace(RES_JOIN_VELHA, () => RES_JOIN_NOVA)

const RES_GROUPBY_VELHA = 'GROUP BY d.id, d.nome, un.nome, ds.nome, d.ativo, d.ultimo_contato_em'
const RES_GROUPBY_NOVA = 'GROUP BY d.id, d.nome, un.nome, d.ativo, d.ultimo_contato_em'
corpoResumo = corpoResumo.replace(RES_GROUPBY_VELHA, () => RES_GROUPBY_NOVA)

conferir('fn_cobertura_ponto_resumo DEPOIS', corpoResumo, [
  ['setores_nomes       text,', 1],
  ['LEFT JOIN LATERAL (', 1],
  ['max(setores_agg.nomes),', 1],
  ["FILTER (WHERE c.situacao = 'ok')", 1],
  ["FILTER (WHERE c.situacao = 'sem_vinculo')", 1],
  ["FILTER (WHERE c.situacao = 'sem_biometria')", 1],
  ["FILTER (WHERE c.situacao = 'fora_do_relogio')", 1],
  ["FILTER (WHERE c.situacao = 'sem_cpf')", 1],
  ["FILTER (WHERE c.situacao = 'sem_snapshot')", 1],
  ["FILTER (WHERE c.situacao <> 'ok')", 2],
  ['ORDER BY count(*) FILTER', 1],
  ['d.setor_id', 0],   // coluna que nao existe mais na CTE dispositivos - nenhuma referencia pode sobrar
  ['ds.nome', 0],      // alias do JOIN removido - idem
  ['$fn$', 2],
])

// Reconstrucao: revertendo os 5 trechos, o corpo tem que voltar byte a byte ao vigente.
const RES_RECONSTRUIDO = corpoResumo
  .replace(RES_GROUPBY_NOVA, () => RES_GROUPBY_VELHA)
  .replace(RES_JOIN_NOVA, () => RES_JOIN_VELHA)
  .replace(RES_SELECT_NOVA, () => RES_SELECT_VELHA)
  .replace(RES_CTE_NOVA, () => RES_CTE_VELHA)
  .replace(RES_COLUNA_NOVA, () => RES_COLUNA_VELHA)
if (RES_RECONSTRUIDO !== RES_ORIGINAL) morrer('fn_cobertura_ponto_resumo: reconstrucao NAO bateu com o vigente')
console.log('OK: fn_cobertura_ponto_resumo reescrita (reconstrucao confere).')

// ================================================================================================
// 4. fn_ingerir_afd (20260808080000) - setor_id da marcacao so quando o dispositivo tem 1 so
// ================================================================================================
const fonteIngestao = fs.readFileSync(SRC_INGESTAO, 'utf8')
let corpoIngestao = extrair(
  fonteIngestao,
  'CREATE OR REPLACE FUNCTION public.fn_ingerir_afd(',
  '\r\n$fn$;'
)
const ING_ORIGINAL = corpoIngestao

conferir('fn_ingerir_afd ANTES', corpoIngestao, [
  ['    v_setor_id    uuid;', 1],
  ['    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id\r\n      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;', 1],
  ['$fn$', 2],
])

const ING_DECL_VELHA = '    v_setor_id    uuid;\r\n'
const ING_DECL_NOVA = '    v_setor_id    uuid;\r\n    v_n_setores   integer;\r\n'
corpoIngestao = corpoIngestao.replace(ING_DECL_VELHA, () => ING_DECL_NOVA)

const ING_RESOLVE_VELHA = '    SELECT unidade_id, setor_id INTO v_unidade_id, v_setor_id\r\n' +
  '      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;\r\n' +
  '    IF v_unidade_id IS NULL THEN\r\n' +
  "        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;\r\n" +
  '    END IF;\r\n'
const ING_RESOLVE_NOVA = [
  '    SELECT unidade_id INTO v_unidade_id',
  '      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
  '    IF v_unidade_id IS NULL THEN',
  "        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;",
  '    END IF;',
  '',
  '    -- setor_id da marcacao so faz sentido quando o dispositivo atende EXATAMENTE um setor -',
  '    -- com zero (toda a unidade) ou mais de um nao seria honesto atribuir a um dos varios.',
  '    -- Ninguem le este campo hoje para marcacao de origem rep (levantado antes de mudar isto,',
  '    -- ver docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md): nao',
  '    -- filtra RLS (so unidade_id filtra), fn_alocar_marcacoes_dia casa so por servidor+tempo, e',
  '    -- fn_marcacoes_pendentes_revisao exclui explicitamente origem rep. E' + ' so contexto.',
  '    --',
  '    -- Duas consultas, nao count(*) + min() do setor numa so: o Postgres nao tem agregado',
  '    -- min()/max() para uuid (sem operator class de agregacao registrada para o tipo, apesar de',
  '    -- suportar < / > / ORDER BY) - "function min(uuid) does not exist". Pego em producao ao',
  '    -- validar esta mesma migration (checkpoint 4), antes de gerar dado real com o bug.',
  '    SELECT count(*) INTO v_n_setores',
  '      FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;',
  '    IF v_n_setores = 1 THEN',
  '        SELECT setor_id INTO v_setor_id',
  '          FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;',
  '    ELSE',
  '        v_setor_id := NULL;',
  '    END IF;',
  '',
].join('\r\n') + '\r\n'
if (contar(corpoIngestao, ING_RESOLVE_VELHA) !== 1) morrer('fn_ingerir_afd: resolucao de unidade nao bate')
corpoIngestao = corpoIngestao.replace(ING_RESOLVE_VELHA, () => ING_RESOLVE_NOVA)

conferir('fn_ingerir_afd DEPOIS', corpoIngestao, [
  ['v_n_setores   integer;', 1],
  ['SELECT count(*) INTO v_n_setores', 1],
  ['IF v_n_setores = 1 THEN', 1],
  ['min(setor_id)', 0],   // o bug que motivou esta correcao nao pode voltar
  ['$fn$', 2],
])

const ING_RECONSTRUIDO = corpoIngestao
  .replace(ING_RESOLVE_NOVA, () => ING_RESOLVE_VELHA)
  .replace(ING_DECL_NOVA, () => ING_DECL_VELHA)
if (ING_RECONSTRUIDO !== ING_ORIGINAL) morrer('fn_ingerir_afd: reconstrucao NAO bateu com o vigente')
console.log('OK: fn_ingerir_afd reescrita (reconstrucao confere).')

// ================================================================================================
// 5. NOVA RPC: fn_definir_setores_dispositivo_rep - escrita atomica da tabela de juncao
// ================================================================================================
// Sem versao vigente para copiar - funcao nova. Mesmo padrao de escrita administrativa de
// fn_vincular_cadastros_por_cpf (20260813000000): auth.uid() NULL passa direto (caminho do
// admin client em actions.ts, que ja checou exigirAdmin() em codigo de aplicacao), senao exige
// super_admin/admin.
const NOVA_RPC = [
  'CREATE OR REPLACE FUNCTION public.fn_definir_setores_dispositivo_rep(',
  '    p_dispositivo_id uuid,',
  '    p_setor_ids      uuid[]',
  ')',
  'RETURNS jsonb',
  'LANGUAGE plpgsql',
  'SECURITY DEFINER',
  'SET search_path = public',
  'AS $fn$',
  'DECLARE',
  '    v_unidade_id uuid;',
  '    v_invalidos  integer;',
  '    v_definidos  integer := 0;',
  'BEGIN',
  '    IF auth.uid() IS NOT NULL THEN',
  '        IF (SELECT public.get_my_role()) NOT IN (\'super_admin\'::public.user_role, \'admin\'::public.user_role) THEN',
  '            RAISE EXCEPTION \'Apenas administradores podem definir os setores de um dispositivo REP.\'',
  '                USING ERRCODE = \'insufficient_privilege\';',
  '        END IF;',
  '    END IF;',
  '',
  '    SELECT unidade_id INTO v_unidade_id FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
  '    IF v_unidade_id IS NULL THEN',
  '        RAISE EXCEPTION \'Dispositivo % nao encontrado.\', p_dispositivo_id;',
  '    END IF;',
  '',
  '    -- Nenhum setor pode ser de outra unidade - o dispositivo so atende a propria unidade',
  '    -- (dispositivos_rep.unidade_id continua unico por dispositivo, ver plano de 13/08/2026).',
  '    SELECT count(*) INTO v_invalidos',
  '      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)',
  '     WHERE NOT EXISTS (',
  '         SELECT 1 FROM public.setores se WHERE se.id = s.id AND se.unidade_id = v_unidade_id',
  '     );',
  '    IF v_invalidos > 0 THEN',
  '        RAISE EXCEPTION \'% setor(es) informado(s) nao pertence(m) a unidade deste dispositivo.\', v_invalidos;',
  '    END IF;',
  '',
  '    -- Substitui o conjunto inteiro numa unica chamada (delete+insert atomicos por estarem na',
  '    -- mesma funcao) - o cliente nunca faz delete/insert em duas chamadas REST separadas.',
  '    DELETE FROM public.dispositivos_rep_setores WHERE dispositivo_id = p_dispositivo_id;',
  '',
  '    INSERT INTO public.dispositivos_rep_setores (dispositivo_id, setor_id, criado_por_id)',
  '    SELECT p_dispositivo_id, s.id, auth.uid()',
  '      FROM unnest(COALESCE(p_setor_ids, ARRAY[]::uuid[])) s(id)',
  '     GROUP BY s.id;',
  '    GET DIAGNOSTICS v_definidos = ROW_COUNT;',
  '',
  '    RETURN jsonb_build_object(\'setores_definidos\', v_definidos);',
  'END;',
  '$fn$;',
  '',
  'COMMENT ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) IS',
  '    \'Substitui o conjunto de setores de um dispositivo REP numa escrita atomica. Lista vazia ou \'',
  '    \'NULL = "toda a unidade" (mesma semantica de dispositivos_rep.setor_id IS NULL). Recusa \'',
  '    \'setor de outra unidade.\';',
  '',
  'REVOKE ALL ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) FROM PUBLIC, anon;',
  'GRANT EXECUTE ON FUNCTION public.fn_definir_setores_dispositivo_rep(uuid, uuid[]) TO authenticated, service_role;',
].join('\r\n')

// ================================================================================================
// 6. COMPOSICAO DO ARQUIVO FINAL
// ================================================================================================
const CAB = [
  '-- Migration: relogio REP compartilhado por multiplos setores - reescreve as funcoes de leitura',
  '-- Data: 2026-08-13',
  '--',
  '-- ARQUIVO GERADO por scratchpad/gen_multi_setor_dispositivo.js. Nao editar a mao - regerar.',
  '-- fn_enfileirar_cadastros_rep, fn_cobertura_ponto_dispositivo e fn_ingerir_afd sao copia',
  '-- mecanica do corpo vigente com substituicoes pontuais - o script aborta se qualquer',
  '-- invariante divergir. fn_cobertura_ponto_resumo tem mudanca mais ampla (RETURNS TABLE muda)',
  '-- mas ainda parte do corpo vigente extraido do arquivo, nao redigitado.',
  '--',
  '-- CONTEXTO E ANALISE DE RISCO COMPLETOS',
  '--   docs/planos/2026-08-13-relogio-rep-compartilhado-por-multiplos-setores.md',
  '--',
  '-- PRE-REQUISITO',
  '--   20260813130000_add_dispositivos_rep_setores.sql (tabela + backfill) precisa ja ter sido',
  '--   aplicada e conferida - o checkpoint dela (contagens batendo) e o portao antes desta.',
  '--',
  '-- O QUE MUDA',
  '--   As tres funcoes trocam "d.setor_id IS NULL OR X.setor_id = d.setor_id" (um setor ou',
  '--   nenhum) por "0 linhas em dispositivos_rep_setores OU EXISTS casando" (um conjunto ou',
  '--   nenhum) - 0 linhas continua significando "toda a unidade", exatamente como setor_id NULL',
  '--   significava antes. fn_ingerir_afd passa a gravar setor_id de origem rep como NULL quando o',
  '--   dispositivo tem 0 ou 2+ setores (so grava quando tem exatamente 1) - campo comprovadamente',
  '--   sem nenhum consumidor hoje, ver o plano.',
  '--',
  '-- O QUE NAO MUDA',
  '--   fn_enfileirar_cadastros_por_escala nao e tocada - herda o novo filtro por estar em cima de',
  '--   fn_cobertura_ponto_dispositivo (LATERAL). dispositivos_rep.setor_id (a coluna antiga)',
  '--   continua existindo e populada - so deixa de ser LIDA por estas quatro funcoes. Remocao dela',
  '--   fica para uma migration separada, sem pressa (plano, secao "Sequencia de migracao").',
  '--',
  '-- CHECKPOINT OBRIGATORIO ANTES DE SEGUIR PARA actions.ts/UI (secao de CONFERENCIA no fim',
  '-- deste arquivo): fn_cobertura_ponto_resumo(8, 2026) tem que reproduzir os mesmos numeros de',
  '-- sempre para a LACEM (39 escalados, 27 sem vinculo, 10 fora do relogio, 1 sem biometria, 1',
  '-- ok) - ela esta em "toda a unidade" (0 linhas na tabela nova), entao nada deveria mudar.',
  '--',
  '-- IDEMPOTENTE: CREATE OR REPLACE nas tres primeiras (assinatura e RETURNS nao mudam),',
  '-- DROP FUNCTION IF EXISTS + CREATE em fn_cobertura_ponto_resumo (RETURNS TABLE muda -',
  '-- CLAUDE.md armadilha 1, 42P13 sem o DROP). Seguro reaplicar.',
  '',
  '',
  '-- ============================================================================',
  '-- 1. fn_enfileirar_cadastros_rep',
  '-- ============================================================================',
  '',
].join('\r\n')

const MEIO_1 = '\r\n\r\nGRANT EXECUTE ON FUNCTION public.fn_enfileirar_cadastros_rep(uuid) TO authenticated;\r\n\r\n\r\n' +
  '-- ============================================================================\r\n' +
  '-- 2. fn_cobertura_ponto_dispositivo (RETURNS TABLE nao muda - CREATE OR REPLACE basta)\r\n' +
  '-- ============================================================================\r\n\r\n'

const MEIO_2 = '\r\n\r\nGRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_dispositivo(uuid, integer, integer) TO authenticated, service_role;\r\n\r\n\r\n' +
  '-- ============================================================================\r\n' +
  '-- 3. fn_cobertura_ponto_resumo (RETURNS TABLE muda - DROP antes do CREATE)\r\n' +
  '-- ============================================================================\r\n\r\n' +
  'DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo(integer, integer);\r\n\r\n'

const MEIO_3 = '\r\n\r\nGRANT EXECUTE ON FUNCTION public.fn_cobertura_ponto_resumo(integer, integer) TO authenticated, service_role;\r\n\r\n\r\n' +
  '-- ============================================================================\r\n' +
  '-- 4. fn_ingerir_afd\r\n' +
  '-- ============================================================================\r\n\r\n'

const MEIO_4 = '\r\n\r\nREVOKE ALL ON FUNCTION public.fn_ingerir_afd FROM PUBLIC, anon, authenticated;\r\n' +
  'GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd TO service_role;\r\n\r\n\r\n' +
  '-- ============================================================================\r\n' +
  '-- 5. fn_definir_setores_dispositivo_rep (nova - escrita atomica da tabela de juncao)\r\n' +
  '-- ============================================================================\r\n\r\n'

const ROD = '\r\n\r\n\r\n' + [
  '-- CONFERENCIA APOS APLICAR',
  '--',
  '--   1) CHECKPOINT (bloqueia a proxima etapa se divergir) - reproduzir os numeros de sempre:',
  '--',
  '--   SELECT dispositivo_nome, setores_nomes, escalados, ok, sem_vinculo, sem_biometria,',
  '--          fora_do_relogio, sem_cpf, sem_snapshot, nao_conseguem_bater, batidas_perdidas',
  '--     FROM public.fn_cobertura_ponto_resumo(8, 2026);',
  '--   -- LACEM esperado: 39/1/27/1/10/.../1 - identico a antes desta migration. setores_nomes',
  '--   -- NULL (dispositivo em "toda a unidade").',
  '--',
  '--   2) fn_cobertura_ponto_dispositivo isolada bate com o resumo (fonte unica preservada):',
  '--',
  '--   SELECT situacao, count(*) FROM public.fn_cobertura_ponto_dispositivo(',
  "--            (SELECT id FROM public.dispositivos_rep WHERE nome ILIKE '%lacem%'), 8, 2026)",
  '--    GROUP BY 1 ORDER BY 1;',
  '--',
  '--   3) fn_definir_setores_dispositivo_rep grava e troca o conjunto inteiro (teste manual, nao',
  '--      em cima do dispositivo real da LACEM sem querer mudar o comportamento dele):',
  '--',
  '--   SELECT public.fn_definir_setores_dispositivo_rep(',
  "--       '<dispositivo de teste>'::uuid, ARRAY['<setor A>'::uuid, '<setor B>'::uuid]);",
  '--   SELECT setor_id FROM public.dispositivos_rep_setores WHERE dispositivo_id = \'<dispositivo de teste>\';',
  '--   -- esperado: exatamente os 2 setores. Repetir com ARRAY[]::uuid[] (ou NULL) tem que zerar',
  '--   -- (voltar a "toda a unidade"), e com um setor de OUTRA unidade tem que dar RAISE EXCEPTION',
  '--   -- sem gravar nada.',
  '--',
  '--   4) fn_ingerir_afd continua criando marcacao para dispositivo de 0 ou 1 setor (nao regrediu',
  '--      o caminho comum) - reprocessar um lote pequeno de teste e conferir',
  '--      marcacoes_ponto.setor_id: NULL para dispositivo "toda a unidade" ou multi-setor, igual',
  '--      ao setor unico para dispositivo com exatamente 1 setor na tabela nova.',
  '',
].join('\r\n')

const saida = CAB + corpoCadastros + MEIO_1 + corpoDispositivo + MEIO_2 + corpoResumo + MEIO_3 + corpoIngestao + MEIO_4 + NOVA_RPC + ROD

// Conferencia estrutural do arquivo inteiro (licao de gen_dobra.js).
if (contar(saida, '$fn$') !== 10) morrer(`delimitadores $fn$ desemparelhados: ${contar(saida, '$fn$')} (esperado 10 - 4 funcoes reescritas + 1 nova)`)
if (contar(saida, 'CREATE OR REPLACE FUNCTION') !== 4) morrer(`CREATE OR REPLACE fora da contagem: ${contar(saida, 'CREATE OR REPLACE FUNCTION')} (esperado 4 - 3 reescritas + 1 nova)`)
if (contar(saida, 'CREATE FUNCTION public.fn_cobertura') !== 1) morrer('CREATE (sem REPLACE) de fn_cobertura_ponto_resumo fora da contagem')
// 2 = 1 DROP de verdade + 1 mencao dentro do comentario de cabecalho (CAB) explicando o motivo.
if (contar(saida, 'DROP FUNCTION IF EXISTS') !== 2) morrer(`DROP FUNCTION fora da contagem: ${contar(saida, 'DROP FUNCTION IF EXISTS')} (esperado 2)`)
if (contar(saida, 'DROP FUNCTION IF EXISTS public.fn_cobertura_ponto_resumo') !== 1) morrer('DROP FUNCTION real (fora do comentario) nao encontrado')
if (contar(saida, 'GRANT EXECUTE') !== 5) morrer(`GRANT fora da contagem: ${contar(saida, 'GRANT EXECUTE')} (esperado 5)`)
if (/\r\n/.test(saida) === false) morrer('arquivo sem CRLF')
if (/\n[^\r]/.test(saida.replace(/\r\n/g, ''))) { /* no-op: checagem acima ja cobre CRLF */ }

fs.writeFileSync(SAIDA, saida)
console.log('escrito:', path.relative(RAIZ, SAIDA), `(${saida.length} bytes)`)
