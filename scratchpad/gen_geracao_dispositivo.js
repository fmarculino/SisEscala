#!/usr/bin/env node
/**
 * Gera supabase/migrations/20260906120000_geracao_do_equipamento.sql
 *
 * POR QUE UM GERADOR (armadilha 1 do CLAUDE.md): tres funcoes vivas precisam ganhar UMA coluna
 * cada. Redigitar o corpo delas ja apagou logica critica seis vezes neste projeto. Aqui o corpo
 * e' COPIADO da migration vigente de cada uma e sofre substituicoes pontuais, com contagem
 * esperada; qualquer divergencia ABORTA sem escrever arquivo nenhum.
 *
 * As fontes NAO sao as que o nome sugere - foram descobertas com
 *   grep -rln "FUNCTION public.<nome>" supabase/migrations | sort | tail -1
 *
 *   fn_cursor_afd_dispositivo  -> 20260817160000 (nao a 20260817150000, que ela corrigiu)
 *   fn_registrar_marcacao      -> 20260808070000
 *   fn_ingerir_afd             -> 20260822210000 (nao a 20260808080000 nem a 20260818200000)
 *
 * Rodar:  node scratchpad/gen_geracao_dispositivo.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const MIG = path.join(RAIZ, 'supabase', 'migrations')
const SAIDA = path.join(MIG, '20260906120000_geracao_do_equipamento.sql')

const FONTES = {
  cursor: '20260817160000_fix_rep_afd_cursor_min_nsr.sql',
  marcacao: '20260808070000_sync_marcacoes_from_escala_diaria.sql',
  ingerir: '20260822210000_ponto_valido_desde_por_dispositivo.sql',
}

let falhas = []
function exigir(cond, msg) { if (!cond) falhas.push(msg) }

function ler(nome) {
  const p = path.join(MIG, nome)
  if (!fs.existsSync(p)) { falhas.push(`fonte ausente: ${nome}`); return '' }
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
}

/** Recorta de `inicio` ate o primeiro `fim` DEPOIS dele (inclusive). */
function recortar(src, inicio, fim, rotulo) {
  const i = src.indexOf(inicio)
  if (i < 0) { falhas.push(`${rotulo}: marcador de inicio nao encontrado`); return '' }
  const j = src.indexOf(fim, i)
  if (j < 0) { falhas.push(`${rotulo}: marcador de fim nao encontrado`); return '' }
  return src.slice(i, j + fim.length)
}

/**
 * Substituicao com contagem esperada.
 * ⚠️ O segundo argumento de String.replace e' SEMPRE uma funcao: com string, o JS interpreta
 * $$ (que fecha dollar-quoting do plpgsql) e $' (que existe dentro de ~ '^[0-9]+$'). Isso ja
 * produziu um `syntax error at or near "$"` em 20260809000000.
 */
function trocar(texto, de, para, esperado, rotulo) {
  const partes = texto.split(de)
  const achou = partes.length - 1
  if (achou !== esperado) {
    falhas.push(`${rotulo}: esperava ${esperado} ocorrencia(s), achou ${achou}`)
    return texto
  }
  return partes.join(para)
}

// ---------------------------------------------------------------------------
// 1. fn_cursor_afd_dispositivo — passa a contar DENTRO da geracao vigente
// ---------------------------------------------------------------------------
const srcCursor = ler(FONTES.cursor)
let fnCursor = recortar(
  srcCursor,
  'CREATE OR REPLACE FUNCTION public.fn_cursor_afd_dispositivo(p_dispositivo_id uuid)',
  '$fn$;',
  'fn_cursor_afd_dispositivo'
)

// Invariante de entrada: o calculo por trecho contiguo (LEAD) tem que estar la'. Se alguem
// tiver reescrito a funcao para outra coisa, o recorte nao serve e a substituicao abaixo
// silenciosamente nao se aplicaria.
exigir(/LEAD\(r\.nsr\) OVER \(ORDER BY r\.nsr\)/.test(fnCursor),
  'fn_cursor_afd_dispositivo: calculo por trecho contiguo (LEAD) ausente na fonte')

fnCursor = trocar(
  fnCursor,
  '                 WHERE r.dispositivo_id = p_dispositivo_id) t',
  '                 WHERE r.dispositivo_id = p_dispositivo_id\n'
  + '                   AND r.geracao = (SELECT d.geracao_atual\n'
  + '                                      FROM public.dispositivos_rep d\n'
  + '                                     WHERE d.id = p_dispositivo_id)) t',
  1,
  'fn_cursor_afd_dispositivo: filtro de geracao'
)

// ---------------------------------------------------------------------------
// 2. fn_registrar_marcacao — DERIVA a geracao, nao ganha parametro
// ---------------------------------------------------------------------------
// Decisao: NAO acrescentar p_geracao. Assinatura nova e' objeto NOVO (armadilha 41) e exigiria
// DROP da de 16 argumentos, que 14 migrations chamam por posicao. Derivar de dentro tem a
// propriedade que o projeto prefere: nenhum chamador novo pode ESQUECER de passar a geracao.
const srcMarc = ler(FONTES.marcacao)
let fnMarcacao = recortar(
  srcMarc,
  'CREATE OR REPLACE FUNCTION public.fn_registrar_marcacao(',
  '$fnreg$;',
  'fn_registrar_marcacao'
)

exigir(/INSERT INTO public\.marcacoes_ponto/.test(fnMarcacao),
  'fn_registrar_marcacao: INSERT em marcacoes_ponto ausente na fonte')
exigir(/COALESCE\(p_sintetica, date_part\('second', p_ocorrido_em\) = 0\)/.test(fnMarcacao),
  'fn_registrar_marcacao: derivacao de `sintetica` ausente - nao pode se perder')

fnMarcacao = trocar(
  fnMarcacao,
  'DECLARE\n    v_id uuid;\nBEGIN',
  'DECLARE\n    v_id      uuid;\n    v_geracao smallint;\nBEGIN',
  1,
  'fn_registrar_marcacao: declaracao de v_geracao'
)

fnMarcacao = trocar(
  fnMarcacao,
  '    IF p_ocorrido_em IS NULL OR p_origem IS NULL THEN\n        RETURN NULL;\n    END IF;\n',
  '    IF p_ocorrido_em IS NULL OR p_origem IS NULL THEN\n        RETURN NULL;\n    END IF;\n'
  + '\n'
  + '    -- Geracao do equipamento que produziu esta marcacao. Marcacao sem dispositivo\n'
  + '    -- (terminal, ajuste manual) fica na geracao 1, que e o DEFAULT da coluna: o campo so\n'
  + '    -- tem significado para origem `rep`, e e la que a unicidade por NSR o usa.\n'
  + '    IF p_dispositivo_id IS NOT NULL THEN\n'
  + '        SELECT d.geracao_atual INTO v_geracao\n'
  + '          FROM public.dispositivos_rep d WHERE d.id = p_dispositivo_id;\n'
  + '    END IF;\n',
  1,
  'fn_registrar_marcacao: leitura da geracao'
)

fnMarcacao = trocar(
  fnMarcacao,
  '        dispositivo_id, nsr, afd_registro_id, identificador_bruto, via_pendrive,\n        observacao\n    ) VALUES (',
  '        dispositivo_id, geracao, nsr, afd_registro_id, identificador_bruto, via_pendrive,\n        observacao\n    ) VALUES (',
  1,
  'fn_registrar_marcacao: coluna geracao no INSERT'
)

fnMarcacao = trocar(
  fnMarcacao,
  '        p_dispositivo_id, p_nsr, p_afd_registro_id, p_identificador_bruto, p_via_pendrive,',
  '        p_dispositivo_id, COALESCE(v_geracao, 1), p_nsr, p_afd_registro_id, p_identificador_bruto, p_via_pendrive,',
  1,
  'fn_registrar_marcacao: valor da geracao no INSERT'
)

// ---------------------------------------------------------------------------
// 3. fn_ingerir_afd — grava a geracao, encadeia o hash DENTRO dela
// ---------------------------------------------------------------------------
const srcIng = ler(FONTES.ingerir)
let fnIngerir = recortar(
  srcIng,
  'CREATE OR REPLACE FUNCTION public.fn_ingerir_afd(',
  '$fn$;',
  'fn_ingerir_afd'
)

// Invariantes de entrada: o que NAO pode ter se perdido da versao vigente.
exigir(/IF FOUND AND v_existente\.status = 'concluida' THEN/.test(fnIngerir),
  'fn_ingerir_afd: atalho de idempotencia por lote ausente na fonte')
exigir(/fn_servidor_por_identificador_afd\(p_dispositivo_id, v_p\.identificador,/.test(fnIngerir),
  'fn_ingerir_afd: resolucao de identidade ausente na fonte')
exigir(/fn_reconciliar_marcacoes_dia\(r\.servidor_id, r\.data_batida\)/.test(fnIngerir),
  'fn_ingerir_afd: auto-reconciliacao ausente na fonte')
exigir(/'AFD NSR ' \|\| v_p\.nsr::text/.test(fnIngerir),
  'fn_ingerir_afd: observacao da marcacao ausente na fonte')

fnIngerir = trocar(
  fnIngerir,
  '    v_unidade_id  uuid;\n    v_setor_id    uuid;',
  '    v_unidade_id  uuid;\n    v_geracao     smallint;\n    v_setor_id    uuid;',
  1,
  'fn_ingerir_afd: declaracao de v_geracao'
)

fnIngerir = trocar(
  fnIngerir,
  '    SELECT unidade_id INTO v_unidade_id\n      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
  '    SELECT unidade_id, geracao_atual INTO v_unidade_id, v_geracao\n      FROM public.dispositivos_rep WHERE id = p_dispositivo_id;',
  1,
  'fn_ingerir_afd: leitura de geracao_atual'
)

// A cadeia de hash NAO pode atravessar equipamentos: o ultimo elo tem que ser o da geracao
// vigente, senao o primeiro registro do relogio novo encadeia no ultimo do relogio velho e a
// cadeia passa a afirmar uma continuidade que nao existiu.
fnIngerir = trocar(
  fnIngerir,
  '     WHERE dispositivo_id = p_dispositivo_id\n     ORDER BY nsr DESC LIMIT 1;',
  '     WHERE dispositivo_id = p_dispositivo_id\n       AND geracao = v_geracao\n     ORDER BY nsr DESC LIMIT 1;',
  1,
  'fn_ingerir_afd: cadeia de hash por geracao'
)

fnIngerir = trocar(
  fnIngerir,
  '            dispositivo_id, nsr, tipo_registro, linha_bruta, linha_sha256,',
  '            dispositivo_id, geracao, nsr, tipo_registro, linha_bruta, linha_sha256,',
  1,
  'fn_ingerir_afd: coluna geracao no INSERT'
)

fnIngerir = trocar(
  fnIngerir,
  "            p_dispositivo_id, v_p.nsr, COALESCE(v_p.tipo, '?'), v_linha, v_sha,",
  "            p_dispositivo_id, v_geracao, v_p.nsr, COALESCE(v_p.tipo, '?'), v_linha, v_sha,",
  1,
  'fn_ingerir_afd: valor da geracao no INSERT'
)

fnIngerir = trocar(
  fnIngerir,
  '        ON CONFLICT (dispositivo_id, nsr) DO NOTHING',
  '        ON CONFLICT (dispositivo_id, geracao, nsr) DO NOTHING',
  1,
  'fn_ingerir_afd: ON CONFLICT com geracao'
)

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
const CABECALHO = `-- ============================================================================
-- Geracao do equipamento: trocar o relogio deixa de descartar batida em silencio
-- ============================================================================
-- 06/09/2026. Plano em docs/planos/2026-09-06-troca-de-relogio-e-ciclo-de-vida-do-cadastro-rep.md
--
-- O CASO REAL (CCE / HMM): o REP queimou e foi trocado por um equipamento NOVO, mesmo IP e
-- mesma senha. O AFD do relogio novo recomeca no NSR 1. O SisEscala nao percebeu nada:
--
--   * fn_cursor_afd_dispositivo devolvia 111509 (fim do trecho contiguo do equipamento ANTIGO
--     + 1) contra um relogio cujo maior NSR e' pequeno. get_afd.fcgi devolve NADA, e a
--     sincronizacao e' gravada como "concluida" em TODO ciclo. Sintoma: nenhum.
--
--   * Se a batida chegasse seria PIOR: uq_afd_dispositivo_nsr e uq_marcacao_rep_nsr sao
--     (dispositivo_id, nsr), entao os NSR 1..N do relogio novo colidiriam com os do antigo e
--     o ON CONFLICT ... DO NOTHING os descartaria como duplicados. Sem erro em lugar nenhum.
--
-- A CORRECAO: uma coluna "geracao" que diz QUAL equipamento disse aquele NSR. O par
-- (dispositivo, geracao, nsr) volta a ser unico de verdade, e o cursor conta dentro da
-- geracao vigente - relogio novo faz o cursor voltar a 1 sozinho.
--
-- ⚠️ "nsr" continua sendo EXATAMENTE o que o equipamento disse. A alternativa considerada -
-- um nsr_offset por dispositivo, que evitaria reconstruir os dois indices - foi DESCARTADA:
-- falsificaria um campo do artefato legal. linha_bruta ficaria intacta, mas a coluna nsr
-- passaria a mentir para qualquer auditoria que a leia.
--
-- ⚠️ O SisEscala NAO troca a geracao sozinho. Detectar substituicao e' palpite (o relogio pode
-- so ter tido a memoria lida errado); trocar por engano cria um AFD paralelo que ninguem pediu.
-- Quem troca e' uma pessoa, por fn_registrar_substituicao_dispositivo, e fica registrado.
--
-- ⚠️ ADD COLUMN ... DEFAULT e' barato (PG11+ guarda o default no catalogo, sem reescrever a
-- tabela). O custo real desta migration e' reconstruir os DOIS indices unicos (~2,5M e ~2,4M
-- linhas em 06/09/2026). MEDIR EM HOMOLOGACAO ANTES de aplicar em producao.
--
-- ⚠️ marcacoes_ponto e' INSERT-only. ADD COLUMN e' DDL e nao dispara o trigger de
-- imutabilidade; e como fn_bloquear_alteracao_marcacao compara to_jsonb(NEW) - '<campo>', a
-- coluna nova ja entra coberta pelos TRES ramos existentes (reparse de AFD, fusao de setor,
-- mesclagem de cadastro) sem nenhuma edicao neles. Os tres precisam continuar la.
--
-- ⚠️ ESTE ARQUIVO E' GERADO. Nao edite a mao: rode
--     node scratchpad/gen_geracao_dispositivo.js
-- O gerador copia fn_cursor_afd_dispositivo, fn_registrar_marcacao e fn_ingerir_afd das
-- migrations VIGENTES de cada uma e aborta se qualquer substituicao nao bater na contagem.
-- ============================================================================

-- ============================================================================
-- 1. COLUNAS
-- ============================================================================

ALTER TABLE public.dispositivos_rep
    ADD COLUMN IF NOT EXISTS geracao_atual smallint NOT NULL DEFAULT 1;

ALTER TABLE public.rep_afd_registros
    ADD COLUMN IF NOT EXISTS geracao smallint NOT NULL DEFAULT 1;

ALTER TABLE public.marcacoes_ponto
    ADD COLUMN IF NOT EXISTS geracao smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.dispositivos_rep.geracao_atual IS
    'Qual equipamento fisico esta neste ponto agora. Comeca em 1 e e incrementada apenas por '
    'fn_registrar_substituicao_dispositivo, nunca automaticamente.';

COMMENT ON COLUMN public.rep_afd_registros.geracao IS
    'Geracao do equipamento que emitiu este NSR. Junto com (dispositivo_id, nsr) forma a chave '
    'unica: dois equipamentos no mesmo ponto emitem NSR 1 cada um, e os dois sao verdadeiros.';

COMMENT ON COLUMN public.marcacoes_ponto.geracao IS
    'Espelha rep_afd_registros.geracao. So tem significado para origem = rep; marcacao de '
    'terminal fica na geracao 1 por DEFAULT.';

-- ============================================================================
-- 2. HISTORICO DE SUBSTITUICAO (append-only)
-- ============================================================================
-- Sem policy de escrita, de proposito: so a RPC SECURITY DEFINER grava. Trocar a geracao muda
-- como todo o AFD passado e' lido - nao pode ser um UPDATE que qualquer autenticado faz pelo
-- PostgREST (armadilha 12).

CREATE TABLE IF NOT EXISTS public.dispositivos_rep_substituicoes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispositivo_id      uuid NOT NULL REFERENCES public.dispositivos_rep(id) ON DELETE CASCADE,
    geracao_anterior    smallint NOT NULL,
    geracao_nova        smallint NOT NULL,
    -- Fotografia do que a geracao anterior deixou. Depois da troca, esses numeros nao sao mais
    -- deriva'veis de forma obvia na tela, e sao eles que explicam por que o cursor caiu.
    nsr_max_anterior    bigint,
    registros_anteriores bigint,
    motivo              text NOT NULL,
    numero_serie_anterior text,
    numero_serie_novo   text,
    registrado_por_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_substituicao_avanca CHECK (geracao_nova > geracao_anterior),
    CONSTRAINT chk_substituicao_motivo CHECK (length(btrim(motivo)) >= 5)
);

CREATE INDEX IF NOT EXISTS idx_disp_rep_substituicoes_dispositivo
    ON public.dispositivos_rep_substituicoes (dispositivo_id, created_at DESC);

ALTER TABLE public.dispositivos_rep_substituicoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de substituicoes de dispositivo" ON public.dispositivos_rep_substituicoes;
CREATE POLICY "Leitura de substituicoes de dispositivo"
    ON public.dispositivos_rep_substituicoes FOR SELECT
    TO authenticated
    USING (public.get_my_role() IN ('super_admin', 'admin', 'rh', 'rh_unidade'));

-- ============================================================================
-- 3. UNICIDADE POR (dispositivo, geracao, nsr)
-- ============================================================================
-- Cria o novo ANTES de derrubar o velho. Dentro da transacao da migration nao ha janela sem
-- unicidade em momento nenhum; a ordem so garante que, se o novo falhar, o velho continua la.

ALTER TABLE public.rep_afd_registros
    DROP CONSTRAINT IF EXISTS uq_afd_dispositivo_geracao_nsr;
ALTER TABLE public.rep_afd_registros
    ADD CONSTRAINT uq_afd_dispositivo_geracao_nsr UNIQUE (dispositivo_id, geracao, nsr);
ALTER TABLE public.rep_afd_registros
    DROP CONSTRAINT IF EXISTS uq_afd_dispositivo_nsr;

DROP INDEX IF EXISTS public.uq_marcacao_rep_geracao_nsr;
CREATE UNIQUE INDEX uq_marcacao_rep_geracao_nsr
    ON public.marcacoes_ponto (dispositivo_id, geracao, nsr) WHERE origem = 'rep';
DROP INDEX IF EXISTS public.uq_marcacao_rep_nsr;

-- Nenhum indice a mais. A propria constraint uq_afd_dispositivo_geracao_nsr ja e um btree
-- (dispositivo_id, geracao, nsr) e serve as duas consultas quentes - o LEAD do cursor e o
-- "ultimo elo da cadeia" de fn_ingerir_afd, que le em ordem DESC (btree varre para tras sem
-- custo). Um indice DESC dedicado seria 2,5M linhas construidas para nada.

-- ============================================================================
-- 4. fn_cursor_afd_dispositivo - conta DENTRO da geracao vigente
-- ============================================================================
-- Copiada de ${FONTES.cursor}. A unica mudanca e' o filtro de geracao na
-- subconsulta: sem ele, o trecho contiguo do equipamento ANTIGO define o cursor do NOVO.

`

const RODAPE_CURSOR = `

REVOKE ALL ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_cursor_afd_dispositivo(uuid) IS
    'NSR a pedir ao equipamento: fim do primeiro trecho contiguo DENTRO da geracao vigente, '
    'mais 1. Equipamento substituido (geracao nova, zero registros) devolve 1 e o AFD inteiro '
    'do relogio novo entra sem colidir com o do antigo.';

-- ============================================================================
-- 5. fn_registrar_marcacao - deriva a geracao do dispositivo
-- ============================================================================
-- Copiada de ${FONTES.marcacao}.
-- Nao ganhou parametro de proposito: assinatura nova seria objeto NOVO (armadilha 41), exigiria
-- DROP da de 16 argumentos e 14 migrations a chamam por posicao. Derivar de dentro tambem torna
-- impossivel um chamador novo esquecer de passar a geracao.

`

const RODAPE_MARCACAO = `

COMMENT ON FUNCTION public.fn_registrar_marcacao IS
    'Ponto unico de insercao em marcacoes_ponto. Deriva sintetica dos segundos zerados e a '
    'geracao do dispositivo quando nao informada. marcacoes_ponto e INSERT-only: nao existe '
    'funcao de alteracao por design.';

REVOKE ALL ON FUNCTION public.fn_registrar_marcacao FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_marcacao TO service_role;

-- ============================================================================
-- 6. fn_ingerir_afd - grava a geracao e encadeia o hash dentro dela
-- ============================================================================
-- Copiada de ${FONTES.ingerir}.

`

const RODAPE_INGERIR = `
-- Assinatura conferida contra a migration vigente, nao chutada.
REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    TO service_role;

-- ============================================================================
-- 7. fn_registrar_substituicao_dispositivo - a troca, feita por uma pessoa
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_substituicao_dispositivo(
    p_dispositivo_id  uuid,
    p_motivo          text,
    p_numero_serie_novo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fnsub$
DECLARE
    v_disp        public.dispositivos_rep%ROWTYPE;
    v_nsr_max     bigint;
    v_registros   bigint;
    v_nova        smallint;
    v_papel       text;
BEGIN
    -- Guard de papel. Trocar a geracao muda como todo o AFD daquele ponto e' lido dali em
    -- diante; nao e' operacao de coordenador. auth.uid() nulo = service_role (script de
    -- manutencao), que passa - o mesmo criterio de fn_blocos_previstos_dia.
    IF auth.uid() IS NOT NULL THEN
        v_papel := public.get_my_role();
        IF v_papel IS NULL OR v_papel NOT IN ('super_admin', 'admin') THEN
            RAISE EXCEPTION 'Apenas Administrador pode registrar substituicao de equipamento.';
        END IF;
    END IF;

    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
        RAISE EXCEPTION 'Informe o motivo da substituicao (minimo 5 caracteres).';
    END IF;

    SELECT * INTO v_disp FROM public.dispositivos_rep WHERE id = p_dispositivo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispositivo % nao cadastrado.', p_dispositivo_id;
    END IF;

    SELECT COALESCE(MAX(r.nsr), 0), COUNT(*)
      INTO v_nsr_max, v_registros
      FROM public.rep_afd_registros r
     WHERE r.dispositivo_id = p_dispositivo_id
       AND r.geracao = v_disp.geracao_atual;

    v_nova := v_disp.geracao_atual + 1;

    INSERT INTO public.dispositivos_rep_substituicoes (
        dispositivo_id, geracao_anterior, geracao_nova,
        nsr_max_anterior, registros_anteriores, motivo,
        numero_serie_anterior, numero_serie_novo, registrado_por_id)
    VALUES (
        p_dispositivo_id, v_disp.geracao_atual, v_nova,
        v_nsr_max, v_registros, btrim(p_motivo),
        v_disp.numero_serie, p_numero_serie_novo, auth.uid());

    UPDATE public.dispositivos_rep
       SET geracao_atual = v_nova,
           -- ultimo_nsr e' denormalizado e so' informativo. Mante-lo com o maximo da geracao
           -- anterior faria a tela afirmar que o equipamento novo ja coletou 111 mil linhas.
           ultimo_nsr    = NULL,
           numero_serie  = COALESCE(p_numero_serie_novo, numero_serie),
           updated_at    = now()
     WHERE id = p_dispositivo_id;

    RETURN jsonb_build_object(
        'sucesso', true,
        'geracao_anterior', v_disp.geracao_atual,
        'geracao_nova', v_nova,
        'nsr_max_anterior', v_nsr_max,
        'registros_anteriores', v_registros,
        'cursor_novo', public.fn_cursor_afd_dispositivo(p_dispositivo_id));
END;
$fnsub$;

REVOKE ALL ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_registrar_substituicao_dispositivo(uuid, text, text) IS
    'Registra que o equipamento fisico daquele ponto foi trocado: incrementa a geracao, guarda '
    'o que a anterior deixou e zera o ultimo_nsr denormalizado. O AFD antigo NAO e apagado - '
    'ele continua sendo a prova daquele periodo, apenas noutra geracao.';

-- ============================================================================
-- 8. CONFERENCIA (rodar depois de aplicar)
-- ============================================================================
--
-- 8.1 As colunas e a unicidade nova existem, e a antiga saiu:
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.rep_afd_registros'::regclass AND contype = 'u';
--   -- esperado: uq_afd_dispositivo_geracao_nsr (e NAO uq_afd_dispositivo_nsr)
--
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'marcacoes_ponto' AND indexname LIKE 'uq_marcacao_rep%';
--   -- esperado: uq_marcacao_rep_geracao_nsr apenas
--
-- 8.2 Nada mudou de valor para quem nao trocou de relogio (toda linha existente vira geracao 1):
--
--   SELECT geracao, count(*) FROM public.rep_afd_registros GROUP BY 1;
--   SELECT geracao, count(*) FROM public.marcacoes_ponto WHERE origem = 'rep' GROUP BY 1;
--   -- esperado: uma unica linha, geracao = 1, com as contagens de antes
--
-- 8.3 O cursor de cada dispositivo continua o mesmo de antes da migration (nenhum saltou):
--
--   SELECT d.nome, d.geracao_atual, d.ultimo_nsr,
--          public.fn_cursor_afd_dispositivo(d.id) AS cursor
--     FROM public.dispositivos_rep d WHERE d.ativo ORDER BY d.nome;
--
-- 8.4 SO ENTAO, para o CCE-01 (o relogio que foi trocado):
--
--   SELECT public.fn_registrar_substituicao_dispositivo(
--            '<uuid do CCE-01>',
--            'Equipamento queimou e foi substituido em 06/09/2026; AFD do novo recomeca no NSR 1.');
--   -- esperado: cursor_novo = 1
--
-- 8.5 Depois do proximo ciclo do coletor, o AFD do relogio novo tem que ter entrado:
--
--   SELECT geracao, count(*), min(nsr), max(nsr)
--     FROM public.rep_afd_registros WHERE dispositivo_id = '<uuid do CCE-01>' GROUP BY 1;
--   -- esperado: duas linhas - a geracao 1 intacta, e a geracao 2 comecando em 1
`

if (falhas.length) {
  console.error('\nABORTADO - o gerador nao escreveu nada:\n')
  falhas.forEach((f) => console.error('  x ' + f))
  console.error('\nAlguma fonte mudou. Confira qual migration define a versao vigente de cada')
  console.error('funcao antes de ajustar o gerador:\n')
  console.error('  grep -rln "FUNCTION public.<nome>" supabase/migrations | sort | tail -1\n')
  process.exit(1)
}

const sql = CABECALHO + fnCursor + RODAPE_CURSOR + fnMarcacao + RODAPE_MARCACAO
  + fnIngerir + RODAPE_INGERIR

// --- Conferencia estrutural do arquivo inteiro (o padrao de gen_dobra.js) -------------------
const estruturais = [
  ['delimitadores $fn$ em pares', (sql.match(/\$fn\$/g) || []).length, 4],
  ['delimitadores $fnreg$ em pares', (sql.match(/\$fnreg\$/g) || []).length, 2],
  ['delimitadores $fnsub$ em pares', (sql.match(/\$fnsub\$/g) || []).length, 2],
  ['CREATE OR REPLACE FUNCTION', (sql.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 4],
  ['ON CONFLICT com geracao', (sql.match(/ON CONFLICT \(dispositivo_id, geracao, nsr\)/g) || []).length, 1],
  ['ON CONFLICT antigo remanescente', (sql.match(/ON CONFLICT \(dispositivo_id, nsr\)/g) || []).length, 0],
]
const ruins = estruturais.filter(([, achou, esperado]) => achou !== esperado)
if (ruins.length) {
  console.error('\nABORTADO - conferencia estrutural do arquivo montado falhou:\n')
  ruins.forEach(([o, a, e]) => console.error(`  x ${o}: esperava ${e}, achou ${a}`))
  process.exit(1)
}

fs.writeFileSync(SAIDA, sql.replace(/\n/g, '\r\n'), 'utf8')
console.log('OK  ' + path.relative(RAIZ, SAIDA))
console.log('    ' + sql.split('\n').length + ' linhas, 4 funcoes, 2 indices unicos trocados')
