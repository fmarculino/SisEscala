/**
 * Gera 20260827000000_travar_terminal_classico_desabilitado.sql.
 *
 * Copia MECANICAMENTE o corpo vigente de fn_registrar_ponto (20260808100000) e de
 * fn_registrar_ponto_terminal_local (20260811180000) — armadilha 1 do CLAUDE.md: essas
 * funcoes nao se redigitam a mao. Aborta em qualquer contagem divergente.
 */
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'supabase', 'migrations')
const ler = f => fs.readFileSync(path.join(DIR, f), 'utf8')

// ---- 1. Recorta as funcoes vigentes ---------------------------------------
function recortar(sql, assinatura, arquivo) {
  const ini = sql.indexOf(assinatura)
  if (ini < 0) throw new Error(`assinatura nao encontrada em ${arquivo}: ${assinatura}`)
  const fim = sql.indexOf('$fn$;', ini)
  if (fim < 0) throw new Error(`fim da funcao nao encontrado em ${arquivo}`)
  return sql.slice(ini, fim + '$fn$;'.length)
}

const fonteRegistrar = ler('20260808100000_registro_de_ponto_sem_restricao_de_horario.sql')
const fonteLocal = ler('20260811180000_add_terminais_locais.sql')

let fnRegistrar = recortar(fonteRegistrar, 'CREATE OR REPLACE FUNCTION public.fn_registrar_ponto(', '20260808100000')
let fnLocal = recortar(fonteLocal, 'CREATE OR REPLACE FUNCTION public.fn_registrar_ponto_terminal_local(', '20260811180000')

// ---- 2. Invariantes ANTES --------------------------------------------------
const conta = (t, p) => t.split(p).length - 1
const checar = (rotulo, valor, esperado) => {
  if (valor !== esperado) throw new Error(`${rotulo}: esperado ${esperado}, achou ${valor}`)
}
checar('fn_registrar_ponto: chamada a fn_confirmar_presenca', conta(fnRegistrar, 'public.fn_confirmar_presenca('), 1)
checar('fn_registrar_ponto: fn_registrar_marcacao', conta(fnRegistrar, 'public.fn_registrar_marcacao('), 2)
checar('fn_registrar_ponto: bloco EXCEPTION', conta(fnRegistrar, 'EXCEPTION WHEN OTHERS THEN'), 2)
checar('fn_local: delega para fn_registrar_ponto', conta(fnLocal, 'RETURN public.fn_registrar_ponto(p_matricula, p_pin_servidor, v_responsavel_id, NULL);'), 1)

// ---- 3. Substituicoes pontuais --------------------------------------------
const rep = (txt, alvo, novo, rotulo) => {
  const n = conta(txt, alvo)
  if (n !== 1) throw new Error(`${rotulo}: ${n} ocorrencias de "${alvo.slice(0, 50)}"`)
  return txt.split(alvo).join(novo)
}

// 3a. O guard entra ANTES da checagem de identidade: canal desativado nao pode aprender se o
// PIN digitado estaria certo, e a batida nao existe para ser preservada — nao ha o que perder.
const GUARD = [
  '    -- ---- Canal desativado pelo gestor -------------------------------------',
  '    -- terminal_classico_habilitado = false significa "este canal nao existe mais". Ate',
  '    -- 27/08/2026 a chave so escondia os botoes na sidebar e na tela de login: /presenca',
  '    -- continuava servida e esta funcao continuava GRANTada a authenticated, entao quem tinha',
  '    -- o link nos favoritos batia ponto normalmente. Medido em producao: 97 batidas de 18',
  '    -- servidores em 2 unidades DEPOIS de a chave ser desligada em 21/08/2026.',
  '    --',
  '    -- Isto NAO e restricao de horario (Portaria 671/2021, vedacao 1): nao recusa uma batida',
  '    -- por causa da hora dela, recusa um canal que o gestor desligou. Onde o canal esta ligado',
  '    -- a regra de nunca recusar por horario continua valendo byte a byte, abaixo.',
  '    --',
  '    -- O terminal local (/presenca-local) e o mesmo codigo por dentro e NAO pode cair aqui:',
  '    -- fn_registrar_ponto_terminal_local publica o GUC antes de delegar.',
  '    IF NOT public.fn_terminal_classico_habilitado()',
  "       AND COALESCE(current_setting('sisescala.canal_ponto', true), '') <> 'terminal_local'",
  '    THEN',
  '        PERFORM public.fn_log_tentativa_negada(',
  '            NULL::uuid, p_matricula, p_coordenador_id,',
  "            'Terminal classico de presenca desabilitado nas configuracoes globais.',",
  '            NULL, NULL, NULL, NULL, NULL, NULL, NULL);',
  '        RETURN jsonb_build_object(',
  "            'success', false, 'tipo', 'erro',",
  "            'message', 'O terminal de presença está desativado neste sistema. '",
  "                       || 'Registre o ponto no relógio da unidade ou procure a administração.');",
  '    END IF;',
  '',
  '    -- ---- Identidade: o UNICO motivo de recusa -----------------------------',
].join('\n')

fnRegistrar = rep(fnRegistrar,
  '    -- ---- Identidade: o UNICO motivo de recusa -----------------------------',
  GUARD, 'fn_registrar_ponto: inserir guard')

// 3b. O terminal local se identifica antes de delegar.
const PUBLICA_GUC = [
  '    -- O terminal local e um canal PROPRIO, com token de dispositivo e escopo de unidade/setor:',
  '    -- ele nao pode ser desligado junto com o terminal classico. O GUC e local a transacao',
  '    -- (terceiro argumento true), entao nao vaza para nenhuma outra chamada da sessao.',
  "    PERFORM set_config('sisescala.canal_ponto', 'terminal_local', true);",
  '',
  '    RETURN public.fn_registrar_ponto(p_matricula, p_pin_servidor, v_responsavel_id, NULL);',
].join('\n')

fnLocal = rep(fnLocal,
  '    RETURN public.fn_registrar_ponto(p_matricula, p_pin_servidor, v_responsavel_id, NULL);',
  PUBLICA_GUC, 'fn_local: publicar GUC')

// ---- 4. Invariantes DEPOIS -------------------------------------------------
checar('fn_registrar_ponto: chamada a fn_confirmar_presenca (depois)', conta(fnRegistrar, 'public.fn_confirmar_presenca('), 1)
checar('fn_registrar_ponto: fn_registrar_marcacao (depois)', conta(fnRegistrar, 'public.fn_registrar_marcacao('), 2)
checar('fn_registrar_ponto: guard aplicado', conta(fnRegistrar, 'fn_terminal_classico_habilitado()'), 1)
checar('fn_registrar_ponto: bloco EXCEPTION (depois)', conta(fnRegistrar, 'EXCEPTION WHEN OTHERS THEN'), 2)
checar('fn_local: GUC aplicado', conta(fnLocal, "set_config('sisescala.canal_ponto', 'terminal_local', true)"), 1)
checar('fn_local: delega uma vez', conta(fnLocal, 'RETURN public.fn_registrar_ponto('), 1)
for (const [rotulo, txt] of [['fn_registrar_ponto', fnRegistrar], ['fn_local', fnLocal]]) {
  if (conta(txt, '$fn$') !== 2) throw new Error(`${rotulo}: delimitadores $fn$ fora de par`)
  if (conta(txt, 'CREATE OR REPLACE FUNCTION') !== 1) throw new Error(`${rotulo}: CREATE duplicado`)
}

// ---- 5. Monta a migration --------------------------------------------------
const CABECALHO = `-- ============================================================================
-- TRAVA REAL DO TERMINAL CLASSICO DE PRESENCA (/presenca)
-- ============================================================================
-- 27/08/2026
--
-- O PROBLEMA
--   configuracoes_globais.terminal_classico_habilitado = false so ESCONDIA os botoes:
--   src/components/layout/sidebar.tsx e src/app/login/page.tsx liam a chave para nao pintar
--   o link. A rota /presenca continuava servida e public.fn_registrar_ponto continuava
--   GRANTada a authenticated — quem guardou o link nos favoritos continuou batendo ponto.
--
--   Medido em producao em 27/08/2026: a chave foi desligada em 21/08/2026 00:13 e, depois
--   disso, entraram 97 batidas reais de 18 servidores em 2 unidades (SMS e USF ENFERMEIRA
--   ZEZINHA), com 6 coordenadores supervisionando. Nao ha nenhum terminal local cadastrado
--   (terminais_locais = 0 linhas), entao a chave foi desligada antes do substituto existir.
--
-- O QUE ESTA MIGRATION FAZ
--   1. fn_terminal_classico_habilitado() — fonte unica da leitura da chave. Chave ausente
--      conta como HABILITADO, o mesmo default do frontend: um banco sem a chave nao pode
--      ficar sem terminal de ponto por omissao.
--   2. fn_registrar_ponto passa a RECUSAR quando a chave esta desligada, antes de qualquer
--      escrita e antes de conferir o PIN.
--   3. fn_registrar_ponto_terminal_local publica o GUC sisescala.canal_ponto='terminal_local'
--      antes de delegar — o terminal local e outro canal (token de dispositivo, escopo de
--      unidade/setor) e nao pode morrer junto.
--
-- O QUE ISTO NAO E
--   Nao e restricao de horario a marcacao (Portaria 671/2021, vedacao 1). Nada aqui olha a
--   hora da batida: onde o canal esta ligado, fn_registrar_ponto continua registrando
--   SEMPRE, mesmo fora da janela, exatamente como 20260808100000 estabeleceu. O que se
--   recusa e um canal que o gestor desligou — decisao administrativa, reversivel na tela de
--   Configuracoes, e que so faz sentido quando a unidade ja tem relogio ou terminal local.
--
-- ANTES DE APLICAR
--   Confira quem ainda depende deste canal (consulta 3 no rodape). Em 27/08/2026, 8 dos 18
--   servidores acima nao tinham NENHUMA batida no relogio em agosto: para eles, aplicar isto
--   com a chave desligada significa ficar sem meio de registrar ponto.
-- ============================================================================


-- ============================================================================
-- 1. FONTE UNICA DA CHAVE
-- ============================================================================
-- configuracoes_globais e chave/valor com o valor em jsonb — nao existe coluna com este
-- nome (Convencoes do CLAUDE.md). A leitura correta e a mesma que fn_confirmar_presenca
-- usa para o timezone.

CREATE OR REPLACE FUNCTION public.fn_terminal_classico_habilitado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
    SELECT COALESCE(
        (SELECT (valor#>>'{}')::boolean
           FROM public.configuracoes_globais
          WHERE chave = 'terminal_classico_habilitado'),
        true);
$fn$;

COMMENT ON FUNCTION public.fn_terminal_classico_habilitado() IS
    'Fonte unica de configuracoes_globais.terminal_classico_habilitado. Chave ausente = '
    'habilitado, o mesmo default do frontend: banco sem a chave nao fica sem terminal por omissao.';

GRANT EXECUTE ON FUNCTION public.fn_terminal_classico_habilitado() TO authenticated, anon, service_role;


-- ============================================================================
-- 2. fn_registrar_ponto — copia mecanica de 20260808100000 + o guard do canal
-- ============================================================================

`

const MEIO = `

COMMENT ON FUNCTION public.fn_registrar_ponto(text, text, uuid, timestamptz) IS
    'Entrada oficial do terminal de ponto. Envolve fn_confirmar_presenca sem reescreve-la: '
    'confirmada a identidade, a batida SEMPRE e registrada, mesmo fora da janela - a Portaria '
    '671/2021 veda restricao de horario a marcacao. Devolve tipo = sucesso | alerta | erro. '
    'Desde 27/08/2026 recusa quando terminal_classico_habilitado = false, salvo quando o '
    'chamador e o terminal local (GUC sisescala.canal_ponto).';

GRANT EXECUTE ON FUNCTION public.fn_registrar_ponto(text, text, uuid, timestamptz)
    TO authenticated, service_role;


-- ============================================================================
-- 3. fn_registrar_ponto_terminal_local — copia mecanica de 20260811180000 + o GUC
-- ============================================================================

`

const RODAPE = `

COMMENT ON FUNCTION public.fn_registrar_ponto_terminal_local(uuid, text, text) IS
    'Entrada do terminal local (app coletor-rep). Confere que o terminal esta ativo e que a '
    'matricula pertence a unidade/setor do terminal, e delega para fn_registrar_ponto sem '
    'reescreve-la. Publica sisescala.canal_ponto para nao ser barrada pelo desligamento do '
    'terminal classico. service_role apenas.';

REVOKE ALL ON FUNCTION public.fn_registrar_ponto_terminal_local(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_ponto_terminal_local(uuid, text, text) TO service_role;


-- ============================================================================
-- 4. FECHA A PORTA DOS FUNDOS: fn_confirmar_presenca nao e entrada de terminal
-- ============================================================================
-- Achado ao validar a trava acima, em 27/08/2026: public.fn_confirmar_presenca estava
-- executavel por ANON — sem login nenhum. Conferido contra producao chamando
-- POST /rest/v1/rpc/fn_confirmar_presenca so com a anon key: respondeu 200. Com matricula e
-- PIN validos ela grava presenca em escala_diaria direto, sem passar por fn_registrar_ponto —
-- ou seja, sem a trava do canal, sem a fila de revisao e sem o log de tentativa.
--
-- Travar so fn_registrar_ponto deixaria a trava contornavel por uma chamada HTTP. Mesma licao
-- da armadilha 12 do CLAUDE.md: tela filtrada nao protege a RPC.
--
-- Ninguem no aplicativo a chama direto (conferido por grep em src/): o unico caller e
-- fn_registrar_ponto, que e SECURITY DEFINER e roda como dona da funcao — o REVOKE abaixo nao
-- a alcanca. A validacao manual do coordenador usa fn_validar_presenca_manual /
-- fn_confirmar_presenca_manual, que sao outras funcoes e ficam intactas.
--
-- Revoga por NOME, nao por assinatura: fn_confirmar_presenca ja foi recriada com aridades
-- diferentes ao longo do projeto (20260528210000 e 20260611190000 dropam (text,text,uuid) e
-- (text,text,uuid,timestamptz)) e uma sobrecarga esquecida seria a porta continuar aberta.
DO $revoke$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS assinatura
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'fn_confirmar_presenca'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.assinatura);
        RAISE NOTICE 'EXECUTE revogado de anon/authenticated em %', r.assinatura;
    END LOOP;
END;
$revoke$;


-- ============================================================================
-- CONFERENCIA APOS APLICAR
-- ============================================================================
--
--   1) A chave e lida como esperado:
--
--   SELECT public.fn_terminal_classico_habilitado();  -- false em producao em 27/08/2026
--
--   2) Com a chave desligada, o terminal classico recusa SEM tocar em ponto nenhum
--      (use uma matricula real e um PIN QUALQUER — a recusa vem antes de conferir o PIN):
--
--   SELECT public.fn_registrar_ponto('<matricula>', '0000', NULL);
--   -- esperado: tipo = 'erro', mensagem sobre terminal desativado
--   SELECT count(*) FROM public.marcacoes_ponto WHERE registrado_em > now() - interval '1 min';
--   -- esperado: 0 — a recusa nao grava marcacao
--   SELECT mensagem_erro FROM public.logs_tentativas_presenca ORDER BY data_hora_tentativa DESC LIMIT 1;
--   -- esperado: 'Terminal classico de presenca desabilitado nas configuracoes globais.'
--   -- (servidor_id NULL de proposito: fica fora de fn_batidas_reais_recusadas, entao esta
--   --  linha nunca vira horario de folha — armadilha 7 do CLAUDE.md)
--
--   3) Quem ainda dependia deste canal (rode ANTES de aplicar, para saber quem fica sem meio):
--
--   SELECT s.nome, u.nome AS unidade, count(*) AS batidas,
--          (SELECT count(*) FROM public.marcacoes_ponto r
--            WHERE r.servidor_id = m.servidor_id AND r.origem = 'rep'
--              AND r.ocorrido_em >= date_trunc('month', now())) AS batidas_no_relogio
--     FROM public.marcacoes_ponto m
--     JOIN public.servidores s ON s.id = m.servidor_id
--     LEFT JOIN public.unidades u ON u.id = m.unidade_id
--    WHERE m.origem = 'terminal' AND NOT m.sintetica
--      AND m.registrado_em >= '2026-08-21'
--    GROUP BY s.nome, u.nome, m.servidor_id
--    ORDER BY batidas_no_relogio, batidas DESC;
--
--   4) O terminal LOCAL continua passando com a chave desligada (precisa de um terminal
--      cadastrado e ativo — em 27/08/2026 nao ha nenhum):
--
--   SELECT public.fn_registrar_ponto_terminal_local('<terminal_id>', '<matricula>', '<pin>');
--   -- esperado: mesmo formato de sempre, NAO a mensagem de terminal desativado
`

const saida = CABECALHO + fnRegistrar + MEIO + fnLocal + RODAPE

// Migrations do projeto usam CRLF (Convencoes do CLAUDE.md).
const alvo = path.join(DIR, '20260827000000_travar_terminal_classico_desabilitado.sql')
if (fs.existsSync(alvo)) throw new Error('migration ja existe: ' + alvo)
fs.writeFileSync(alvo, saida.replace(/\r?\n/g, '\r\n'))

// Conferencia estrutural do arquivo inteiro (gen_dobra.js e o modelo)
const final = fs.readFileSync(alvo, 'utf8')
checar('arquivo: delimitadores $fn$', conta(final, '$fn$'), 6)
checar('arquivo: CREATE OR REPLACE', conta(final, 'CREATE OR REPLACE FUNCTION'), 3)
checar('arquivo: GRANT', conta(final, 'GRANT EXECUTE ON FUNCTION'), 3)
console.log('gerado:', path.basename(alvo), '|', final.split(/\r\n/).length, 'linhas')
