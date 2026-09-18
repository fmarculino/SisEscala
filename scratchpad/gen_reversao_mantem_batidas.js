// Gera 20260917150000_reversao_pode_manter_batidas.sql a partir de DUAS fontes:
//   fn_reverter_presenca_manual        <- 20260917100000_reverter_presenca_limpa_origem.sql
//   fn_sincronizar_marcacoes_escala_diaria <- 20260917110000_desconsiderar_na_reversao.sql
// Copia mecanica (armadilha 1). ABORTA se qualquer contagem divergir.
//
// ⚠️ DUAS FONTES, e elas NAO estao na mesma migration. Regenerar so a "mais recente" deixaria
//    uma das duas para trás -- foi o que quase aconteceu com o intervalo do plantao em
//    22/08/2026. O gerador confere invariantes contra CADA uma.
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const F_REV = path.join(RAIZ, 'supabase/migrations/20260917100000_reverter_presenca_limpa_origem.sql')
const F_SYNC = path.join(RAIZ, 'supabase/migrations/20260917110000_desconsiderar_na_reversao.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260917150000_reversao_pode_manter_batidas.sql')

function ler(f) {
  const bruto = fs.readFileSync(f, 'utf8')
  // EOL DETECTADO, NUNCA ASSUMIDO (armadilha 59).
  return { eol: bruto.includes('\r\n') ? '\r\n' : '\n', txt: bruto.split(/\r?\n/).join('\n') }
}
const rev = ler(F_REV)
const syn = ler(F_SYNC)
console.log(`fonte 1: ${path.basename(F_REV)} (${rev.eol === '\r\n' ? 'CRLF' : 'LF'})`)
console.log(`fonte 2: ${path.basename(F_SYNC)} (${syn.eol === '\r\n' ? 'CRLF' : 'LF'})`)
const EOL = rev.eol

function recortar(txt, nome, fim) {
  const i = txt.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`)
  if (i < 0) throw new Error(`ABORTADO: nao achei ${nome}.`)
  const f = txt.indexOf(fim, i)
  if (f < 0) throw new Error(`ABORTADO: nao achei o fim de ${nome}.`)
  return txt.slice(i, f + fim.length)
}

let fnRev = recortar(rev.txt, 'fn_reverter_presenca_manual',
  '$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;')
let fnSync = recortar(syn.txt, 'fn_sincronizar_marcacoes_escala_diaria', '\n$fnsync$;')

// ---------------------------------------------------------------------------
// Invariantes da FONTE, por funcao (invariante de copia mecanica e POR FUNCAO).
// ---------------------------------------------------------------------------
const invFonte = [
  ['rev: limpa origem nos 4 passos', fnRev, /_origem = NULL/g, 4],
  ['rev: limpa marcacao_id nos 4 passos', fnRev, /_marcacao_id = NULL/g, 4],
  ['rev: grava o autor em confirmado_por_id', fnRev, /confirmado_por_id = COALESCE\(p_validador_id, confirmado_por_id\)/g, 4],
  ['sync: guard anti-eco da reconciliacao', fnSync, /current_setting\('sisescala\.reconciliacao', true\)/g, 1],
  ['sync: saida rapida de UPDATE sem presenca', fnSync, /IF TG_OP = 'UPDATE'\n       AND NEW\.presenca_entrada_em/g, 1],
  // Padrao ancorado no INSERT: a palavra tambem aparece nos comentarios do trecho.
  ['sync: grava desconsiderar', fnSync, /VALUES \(v_alvo, 'desconsiderar',/g, 1],
  ['sync: aviso quando nao ha autor', fnSync, /RAISE WARNING 'reversao sem autor/g, 1],
  ['sync: nunca trava a batida (EXCEPTION no fim)', fnSync, /RAISE WARNING 'fn_sincronizar_marcacoes_escala_diaria falhou/g, 1],
]
for (const [nome, txt, re, n] of invFonte) {
  const achou = (txt.match(re) || []).length
  if (achou !== n) throw new Error(`ABORTADO: invariante da fonte "${nome}" -> ${achou}, esperado ${n}.`)
}
console.log(`invariantes das fontes: ${invFonte.length} ok`)

const trocas = []
function trocar(rotulo, alvo, de, para, n = 1) {
  const achou = (alvo.match(new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  if (achou !== n) throw new Error(`ABORTADO: "${rotulo}" -> ${achou}, esperado ${n}.`)
  trocas.push(rotulo)
  return alvo.split(de).join(para)
}

// ===========================================================================
// (A) fn_reverter_presenca_manual: o parametro que declara a INTENCAO
// ===========================================================================
fnRev = trocar('rev: parametro p_manter_batidas', fnRev,
  `    p_validador_id uuid
)`,
  `    p_validador_id uuid,
    -- POR QUE a reversao esta sendo feita. false (o default, o comportamento de sempre) = o
    -- horario esta errado, entao a batida sai de circulacao. true = a ESCALA esta errada e o
    -- dia vai ser relancado, entao a batida REAL continua disponivel para a proxima
    -- reconciliacao.
    --
    -- ⚠️ DEFAULT false de proposito: um chamador que nao sabe da distincao tem de continuar
    --    tendo o comportamento antigo. Errar para o lado de "sai de circulacao" e recuperavel
    --    (fn_restaurar_batidas_dia); errar para o outro repoe sozinho um horario que alguem
    --    mandou tirar.
    p_manter_batidas boolean DEFAULT false
)`)

fnRev = trocar('rev: publica o GUC', fnRev,
  `    SELECT servidor_id, unidade_id INTO v_servidor_id, v_unidade_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;`,
  `    SELECT servidor_id, unidade_id INTO v_servidor_id, v_unidade_id
    FROM public.escala_mensal WHERE id = p_escala_mensal_id;

    -- A intencao viaja por GUC porque quem precisa dela e o TRIGGER de sincronizacao, que nao
    -- recebe parametro nenhum. Mesmo mecanismo de sisescala.reconciliacao e sisescala.fundir_setor.
    IF p_manter_batidas THEN
        PERFORM set_config('sisescala.reversao_mantem_batidas', 'on', true);
    END IF;`)

// 🚨 set_config(..., true) e local a TRANSACAO, nao a funcao (achado em 10/09/2026 em
//    fn_excluir_vigencia_jornada). Sem desligar, qualquer UPDATE posterior na MESMA transacao
//    -- um upsert em lote do "Salvar Previsao", por exemplo -- herdaria a excecao e deixaria de
//    desconsiderar batida que alguem mandou tirar.
fnRev = trocar('rev: desliga o GUC antes de cada RETURN (invalido)', fnRev,
  `    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de reversão inválido.');
    END IF;`,
  `    ELSE
        PERFORM set_config('sisescala.reversao_mantem_batidas', 'off', true);
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de reversão inválido.');
    END IF;`)

fnRev = trocar('rev: desliga o GUC antes do RETURN final', fnRev,
  `    RETURN jsonb_build_object('success', true, 'message', 'Presença revertida com sucesso.');`,
  `    -- 🚨 DESLIGA NA MESMA TRANSACAO. set_config(..., true) e local a TRANSACAO, nao a funcao:
    -- deixar ligado faria o proximo UPDATE em escala_diaria desta transacao (o upsert em lote
    -- do "Salvar Previsao", por exemplo) herdar a excecao em silencio.
    PERFORM set_config('sisescala.reversao_mantem_batidas', 'off', true);

    RETURN jsonb_build_object('success', true,
        'message', CASE WHEN p_manter_batidas
                        THEN 'Presença revertida. As batidas reais continuam disponíveis.'
                        ELSE 'Presença revertida com sucesso.' END,
        'manteve_batidas', COALESCE(p_manter_batidas, false));`)

// ===========================================================================
// (B) o trigger: honra a intencao, e SO para batida fisica
// ===========================================================================
fnSync = trocar('sync: declara v_mantem', fnSync,
  `    v_autor       uuid;`,
  `    v_autor       uuid;
    v_mantem      boolean;`)

fnSync = trocar('sync: le o GUC', fnSync,
  `    IF TG_OP = 'UPDATE' THEN
        v_autor := COALESCE(NEW.confirmado_por_id, OLD.confirmado_por_id, auth.uid());`,
  `    IF TG_OP = 'UPDATE' THEN
        v_autor := COALESCE(NEW.confirmado_por_id, OLD.confirmado_por_id, auth.uid());

        -- Quem reverteu declarou que a ESCALA estava errada e o dia vai ser relancado
        -- (fn_reverter_presenca_manual com p_manter_batidas). Ausente = 'off' = comportamento
        -- de sempre: o default de uma regra de retirada e RETIRAR.
        v_mantem := COALESCE(current_setting('sisescala.reversao_mantem_batidas', true), 'off') = 'on';`)

fnSync = trocar('sync: poupa a batida fisica quando declarado', fnSync,
  `             WHERE r.ocorrido_em IS NOT NULL
               AND NOT public.fn_marcacao_desconsiderada(m.id)`,
  `             WHERE r.ocorrido_em IS NOT NULL
               AND NOT public.fn_marcacao_desconsiderada(m.id)
               -- 🚨 SO A BATIDA FISICA e poupada, e so quando a intencao foi declarada.
               -- O horario DECLARADO (ajuste_coordenador / ajuste_servidor) e o FABRICADO
               -- (terminal sintetica, de fn_salvar_saida_bloco) continuam saindo de circulacao
               -- nos dois modos: quem reverteu esta desfazendo a propria declaracao, e manter
               -- o fabricado em circulacao faria a reconciliacao repo-lo como se fosse fato.
               AND NOT (v_mantem AND public.fn_batida_fisica(m.origem, m.sintetica))`)

// ===========================================================================
// montagem
// ===========================================================================
const cabecalho = `-- Migration: reverter presenca pode MANTER a batida real em circulacao
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D2, saida B1)
-- Gerada por scratchpad/gen_reversao_mantem_batidas.js a partir de DUAS fontes:
--   fn_reverter_presenca_manual            <- 20260917100000_reverter_presenca_limpa_origem.sql
--   fn_sincronizar_marcacoes_escala_diaria <- 20260917110000_desconsiderar_na_reversao.sql
--   NAO EDITAR A MAO: regenere pelo script, que aborta se qualquer fonte divergir.
--
-- DEPENDE DE 20260917140000 (fn_batida_fisica). Aplicar fora de ordem morre em runtime, nao
-- no CREATE: plpgsql so resolve nome de funcao na EXECUCAO (armadilha 1).
--
-- O QUE ESTAVA ERRADO
--   O trigger de sincronizacao grava 'desconsiderar' sempre que um UPDATE zera um passo de
--   presenca, e nao sabe POR QUE o passo esta sendo zerado. Sao duas intencoes opostas:
--
--     "o horario esta errado"   -> a batida tem de sair de circulacao. E para isso que o
--                                  tratamento existe, e continua sendo o default.
--     "a ESCALA esta errada e   -> a batida REAL da pessoa nao tem nada de errado. Hoje ela
--      vou relancar o dia"         sai junto, e o "Preencher pelas Batidas" nao a traz de
--                                  volta: fn_alocar_marcacoes_dia filtra desconsiderada.
--
--   Medido em producao em 17/09/2026: 173 batidas FISICAS fora de circulacao, 20 dias com
--   escala e passo vazio, 16 deles com a tela respondendo "Nada a preencher neste dia".
--   So em 17/09 foram 47 batidas rep, em 14 servidores -- THAYNA (mat 69051) com 12 e GISELE
--   (mat 62240) com 10.
--
-- 🚨 POR QUE NAO "O TRIGGER NUNCA DESCONSIDERA BATIDA FISICA"
--   Essa era a correcao de uma linha, e ela QUEBRA a reversao intencional: a batida de teste,
--   a batida da pessoa errada e a batida indevida voltariam sozinhas na proxima reconciliacao.
--   E foi exatamente o defeito que a 20260917110000 acabou de fechar. A intencao precisa ser
--   DECLARADA por quem reverte -- o banco nao tem como adivinha-la.
--
-- 🚨 ASSINATURA NOVA E OBJETO NOVO (armadilhas 24 e 41)
--   p_manter_batidas tem DEFAULT, entao a chamada de 5 argumentos continua valendo -- MAS as
--   duas assinaturas conviveriam e o PostgREST devolveria PGRST203 ("could not choose the best
--   candidate"). A de 5 argumentos e DERRUBADA aqui, e os privilegios sao REESCRITOS: objeto
--   novo nasce com EXECUTE para PUBLIC.
--
-- ORDEM DE DEPLOY
--   O bundle anterior chama com 5 argumentos e resolve para a assinatura nova com
--   p_manter_batidas = false, que e o comportamento de hoje. Nao ha janela de quebra.


-- ============================================================================
-- 1. A REVERSAO (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid);

`

const meio = `

REVOKE ALL ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean) IS
    'Zera um passo de presenca em escala_diaria: horario, flag manual, ORIGEM e marcacao_id. '
    'p_manter_batidas declara POR QUE: false (default) tira a batida de circulacao, como sempre; '
    'true poupa a batida FISICA, para quem esta corrigindo a ESCALA e vai relancar o dia. '
    'A intencao chega ao trigger de sincronizacao pelo GUC sisescala.reversao_mantem_batidas, '
    'que e DESLIGADO antes do retorno -- set_config local vale para a transacao, nao para a funcao.';


-- ============================================================================
-- 2. O TRIGGER (copia mecanica; so o que esta marcado no gerador mudou)
-- ============================================================================

`

const conferencia = `

-- ============================================================================
-- 3. CONFERENCIA -- EXECUTA os dois caminhos (armadilha 42), ensaio revertido
-- ============================================================================
-- Confere os DOIS SENTIDOS. Afrouxar so um lado e o modo de falha perigoso aqui:
--   poupar demais -> batida indevida volta sozinha na proxima reconciliacao;
--   poupar de menos -> continua o defeito que a migration existe para fechar.

DO $conf$
DECLARE
    v_ed      record;
    v_autor   uuid;
    v_marc    uuid;
    v_n       integer;
    v_assin   integer;
BEGIN
    -- 3.1 Exatamente UMA fn_reverter_presenca_manual (sobrecarga = PGRST203)
    SELECT count(*) INTO v_assin
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reverter_presenca_manual';
    IF v_assin <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: ha % versao(oes) de fn_reverter_presenca_manual (esperado 1).', v_assin;
    END IF;

    -- 3.2 anon nao executa; authenticated continua executando (a grade chama com sessao)
    IF has_function_privilege('anon', 'public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon ainda executa fn_reverter_presenca_manual.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.fn_reverter_presenca_manual(uuid, integer, text, text, uuid, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated PERDEU fn_reverter_presenca_manual -- a grade para de reverter.';
    END IF;

    SELECT p.id INTO v_autor FROM public.profiles p LIMIT 1;
    IF v_autor IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917150000: sem profiles; ensaio pulado.';
        RETURN;
    END IF;

    -- 3.3 Ensaio: uma linha com SAIDA preenchida, competencia aberta.
    SELECT ed.id, ed.escala_mensal_id, ed.dia, ed.categoria::text AS categoria, em.servidor_id, em.unidade_id
      INTO v_ed
      FROM public.escala_diaria ed
      JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
     WHERE ed.presenca_saida_em IS NOT NULL
       AND ed.categoria::text <> 'Sobreaviso'
       AND NOT public.fn_competencia_encerrada(em.mes, em.ano)
     LIMIT 1;

    IF v_ed.id IS NULL THEN
        RAISE NOTICE 'CONFERENCIA 20260917150000: nenhuma linha com saida em competencia aberta; ensaio pulado.';
        RETURN;
    END IF;

    -- (a) MODO DECLARADO: a batida FISICA e poupada.
    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao)
    VALUES (v_ed.servidor_id, 'terminal',
            (SELECT presenca_saida_em FROM public.escala_diaria WHERE id = v_ed.id),
            v_ed.unidade_id, false, 'CONFERENCIA 20260917150000')
    RETURNING id INTO v_marc;

    UPDATE public.escala_diaria
       SET presenca_saida_origem = 'terminal'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc
     WHERE id = v_ed.id;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor, true);

    IF public.fn_marcacao_desconsiderada(v_marc) THEN
        RAISE EXCEPTION 'ABORTADO(a): o modo declarado NAO poupou a batida fisica.';
    END IF;

    -- 🚨 O GUC tem de estar DESLIGADO depois do retorno: ele e local a TRANSACAO.
    IF COALESCE(current_setting('sisescala.reversao_mantem_batidas', true), 'off') = 'on' THEN
        RAISE EXCEPTION 'ABORTADO: o GUC ficou LIGADO depois da reversao -- o proximo UPDATE desta transacao herdaria a excecao.';
    END IF;

    -- (b) MODO PADRAO: a mesma batida sai de circulacao.
    UPDATE public.escala_diaria
       SET presenca_saida_em = (SELECT ocorrido_em FROM public.marcacoes_ponto WHERE id = v_marc),
           presenca_saida_origem = 'terminal'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc
     WHERE id = v_ed.id;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor);

    IF NOT public.fn_marcacao_desconsiderada(v_marc) THEN
        RAISE EXCEPTION 'ABORTADO(b): o modo PADRAO deixou de tirar a batida de circulacao -- a reversao intencional voltou a nao durar.';
    END IF;

    -- (c) Horario DECLARADO sai de circulacao nos DOIS modos.
    -- ⚠️ chk_marcacao_ajuste_justificado: origem de AJUSTE exige justificativa preenchida.
    --    Restricao de coluna so aparece na EXECUCAO -- nenhum portao de texto sabe o schema.
    INSERT INTO public.marcacoes_ponto
        (servidor_id, origem, ocorrido_em, unidade_id, sintetica, observacao, coordenador_id, justificativa)
    VALUES (v_ed.servidor_id, 'ajuste_coordenador',
            (SELECT ocorrido_em FROM public.marcacoes_ponto WHERE id = v_marc) + interval '7 minutes',
            v_ed.unidade_id, false, 'CONFERENCIA 20260917150000 declarado', v_autor,
            'CONFERENCIA 20260917150000: horario declarado pelo coordenador')
    RETURNING id INTO v_marc;

    UPDATE public.escala_diaria
       SET presenca_saida_em = (SELECT ocorrido_em FROM public.marcacoes_ponto WHERE id = v_marc),
           presenca_saida_origem = 'ajuste_coordenador'::public.marcacao_origem,
           presenca_saida_marcacao_id = v_marc,
           presenca_saida_manual = true
     WHERE id = v_ed.id;

    PERFORM public.fn_reverter_presenca_manual(
        v_ed.escala_mensal_id, v_ed.dia, v_ed.categoria, 'saida', v_autor, true);

    IF NOT public.fn_marcacao_desconsiderada(v_marc) THEN
        RAISE EXCEPTION 'ABORTADO(c): horario DECLARADO foi poupado no modo declarado -- quem reverte esta desfazendo a propria declaracao.';
    END IF;

    RAISE EXCEPTION 'CONFERENCIA_OK_ROLLBACK';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'CONFERENCIA_OK_ROLLBACK' THEN
            RAISE NOTICE 'CONFERENCIA 20260917150000: OK nos tres sentidos (ensaio revertido).';
        ELSE
            RAISE;
        END IF;
END;
$conf$;
`

const saida = (cabecalho + fnRev + meio + fnSync + conferencia).split('\n').join(EOL)
fs.writeFileSync(DESTINO, saida, 'utf8')

const res = saida.split(/\r?\n/).join('\n')
const invSaida = [
  ['DROP da assinatura de 5 args', /DROP FUNCTION IF EXISTS public\.fn_reverter_presenca_manual\(uuid, integer, text, text, uuid\);/g, 1],
  ['nenhum DROP com CASCADE', /DROP\s+FUNCTION[^;]*CASCADE/gi, 0],
  ['GUC ligado uma vez', /set_config\('sisescala\.reversao_mantem_batidas', 'on', true\)/g, 1],
  ['GUC DESLIGADO nos dois retornos', /set_config\('sisescala\.reversao_mantem_batidas', 'off', true\)/g, 2],
  ['o trigger le o GUC', /current_setting\('sisescala\.reversao_mantem_batidas', true\)/g, 2], // trigger + conferencia
  ['so batida fisica e poupada', /AND NOT \(v_mantem AND public\.fn_batida_fisica\(m\.origem, m\.sintetica\)\)/g, 1],
  ['guard anti-eco preservado', /current_setting\('sisescala\.reconciliacao', true\)/g, 1],
  ['aviso de reversao sem autor preservado', /RAISE WARNING 'reversao sem autor/g, 1],
  ['trigger nunca trava a batida', /RAISE WARNING 'fn_sincronizar_marcacoes_escala_diaria falhou/g, 1],
  ['limpeza de origem preservada nos 4 passos', /_origem = NULL/g, 4],
  ['conferencia EXECUTA a reversao', /PERFORM public\.fn_reverter_presenca_manual\(/g, 3],
]
for (const [nome, re, n] of invSaida) {
  const achou = (res.match(re) || []).length
  if (achou !== n) {
    fs.unlinkSync(DESTINO)
    throw new Error(`ABORTADO: invariante do resultado "${nome}" -> ${achou}, esperado ${n}. Arquivo removido.`)
  }
}

console.log(`substituicoes aplicadas: ${trocas.length}`)
for (const t of trocas) console.log(`  - ${t}`)
console.log(`invariantes do resultado: ${invSaida.length} ok`)
console.log(`\nescrito: ${path.relative(RAIZ, DESTINO)} (${saida.split(/\r?\n/).length} linhas)`)
