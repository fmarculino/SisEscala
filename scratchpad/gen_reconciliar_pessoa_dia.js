// Gera 20260917170000_reconciliar_alcanca_o_cadastro_irmao.sql a partir de TRES fontes:
//   fn_ingerir_afd              <- 20260915100000_abrangencia_do_relogio_estrutura.sql
//   fn_reparse_afd_dispositivo  <- 20260822210000_ponto_valido_desde_por_dispositivo.sql
//   fn_reconciliar_apos_marcacao<- 20260820020000_neutralize_direct_presence_write_in_rep_units.sql
// Copia mecanica (armadilha 1). ABORTA se qualquer contagem divergir.
//
// ⚠️ A VERSAO VIGENTE NAO E A QUE O NOME SUGERE. fn_ingerir_afd aparece em 7 migrations e
//    fn_reparse_afd_dispositivo em 4; as fontes acima sao as ULTIMAS de cada uma
//    (grep -rln "FUNCTION public.<nome>" supabase/migrations/ | sort | tail -1).
const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..')
const F_ING = path.join(RAIZ, 'supabase/migrations/20260915100000_abrangencia_do_relogio_estrutura.sql')
const F_REP = path.join(RAIZ, 'supabase/migrations/20260822210000_ponto_valido_desde_por_dispositivo.sql')
const F_TRG = path.join(RAIZ, 'supabase/migrations/20260820020000_neutralize_direct_presence_write_in_rep_units.sql')
const DESTINO = path.join(RAIZ, 'supabase/migrations/20260917170000_reconciliar_alcanca_o_cadastro_irmao.sql')

function ler(f) {
  const b = fs.readFileSync(f, 'utf8')
  return { eol: b.includes('\r\n') ? '\r\n' : '\n', txt: b.split(/\r?\n/).join('\n') }
}
const ing = ler(F_ING), rep = ler(F_REP), trg = ler(F_TRG)
const EOL = ing.eol
for (const [n, o] of [['ingestao', ing], ['reparse', rep], ['trigger', trg]]) {
  console.log(`fonte ${n}: ${o.eol === '\r\n' ? 'CRLF' : 'LF'}`)
}

function recortar(txt, nome, fim, arg = '(') {
  const i = txt.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}${arg}`)
  if (i < 0) throw new Error(`ABORTADO: nao achei ${nome}.`)
  const f = txt.indexOf(fim, i)
  if (f < 0) throw new Error(`ABORTADO: nao achei o fim de ${nome}.`)
  return txt.slice(i, f + fim.length)
}

let fnIng = recortar(ing.txt, 'fn_ingerir_afd', '\n$fn$;')
let fnRep = recortar(rep.txt, 'fn_reparse_afd_dispositivo', '\n$fn$;')
let fnTrg = recortar(trg.txt, 'fn_reconciliar_apos_marcacao', '\n$fnm$;', '()')

const invFonte = [
  ['ing: reconcilia por servidor da marcacao', fnIng, /PERFORM public\.fn_reconciliar_marcacoes_dia\(r\.servidor_id, r\.data_batida\);/g, 1],
  ['ing: idempotencia do lote', fnIng, /IF FOUND AND v_existente\.status = 'concluida' THEN/g, 1],
  ['ing: resolucao passa o instante da batida', fnIng, /fn_servidor_por_identificador_afd\(p_dispositivo_id, v_p\.identificador,/g, 1],
  ['ing: nunca descartar batida (marcacao criada mesmo orfa)', fnIng, /PERFORM public\.fn_registrar_marcacao\(/g, 1],
  ['rep: reconcilia por servidor', fnRep, /PERFORM public\.fn_reconciliar_marcacoes_dia\(r_rec\.servidor_id, r_rec\.data_batida\);/g, 1],
  ['rep: so mexe em orfa', fnRep, /m.servidor_id IS NULL/g, 1],
  ['trg: reconcilia por servidor', fnTrg, /PERFORM public\.fn_reconciliar_marcacoes_dia\(r\.servidor_id, r\.data_batida\);/g, 1],
  ['trg: guard anti-reentrancia', fnTrg, /current_setting\('sisescala\.reconciliacao', true\)/g, 1],
  ['trg: so em unidade fonte_ponto_oficial = rep', fnTrg, /u\.fonte_ponto_oficial = 'rep'/g, 1],
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

fnIng = trocar('ing: passa a alcancar o irmao', fnIng,
  `                PERFORM public.fn_reconciliar_marcacoes_dia(r.servidor_id, r.data_batida);`,
  `                -- fn_reconciliar_pessoa_dia, nao fn_reconciliar_marcacoes_dia: a batida e da
                -- PESSOA, e o turno pode estar na OUTRA matricula dela. Ver 20260917170000.
                PERFORM public.fn_reconciliar_pessoa_dia(r.servidor_id, r.data_batida);`)

fnRep = trocar('rep: passa a alcancar o irmao', fnRep,
  `                PERFORM public.fn_reconciliar_marcacoes_dia(r_rec.servidor_id, r_rec.data_batida);`,
  `                -- Ver 20260917170000: o reparse re-resolve autoria, e a autoria pode cair no
                -- cadastro irmao da mesma pessoa.
                PERFORM public.fn_reconciliar_pessoa_dia(r_rec.servidor_id, r_rec.data_batida);`)

fnTrg = trocar('trg: passa a alcancar o irmao', fnTrg,
  `            PERFORM public.fn_reconciliar_marcacoes_dia(r.servidor_id, r.data_batida);`,
  `            -- Ver 20260917170000. Este trigger e INERTE hoje (nenhuma unidade esta em
            -- fonte_ponto_oficial = 'rep'), mas vira o caminho principal quando a Fase 5
            -- ligar -- deixa-lo para tras recriaria o buraco justamente ali.
            PERFORM public.fn_reconciliar_pessoa_dia(r.servidor_id, r.data_batida);`)

const cabecalho = `-- Migration: a reconciliacao de maquina passa a alcancar o cadastro IRMAO
-- Data: 2026-09-17
-- Plano: docs/planos/2026-09-17-batida-que-nao-alcanca-a-escala-certa.md (defeito D1)
-- Gerada por scratchpad/gen_reconciliar_pessoa_dia.js a partir de TRES fontes:
--   fn_ingerir_afd               <- 20260915100000_abrangencia_do_relogio_estrutura.sql
--   fn_reparse_afd_dispositivo   <- 20260822210000_ponto_valido_desde_por_dispositivo.sql
--   fn_reconciliar_apos_marcacao <- 20260820020000_neutralize_direct_presence_write_in_rep_units.sql
--   NAO EDITAR A MAO: regenere pelo script, que aborta se qualquer fonte divergir.
--
-- O QUE ESTAVA ERRADO
--   fn_alocar_marcacoes_dia SABE do cadastro irmao desde 20260909130000: os passos do irmao
--   entram como SOMBRA e desqualificam candidata, para exatamente um dos dois ficar com a
--   batida. Mas ela e STABLE -- quem ESCREVE e fn_reconciliar_marcacoes_dia, chamada por
--   (servidor, dia). A leitura enxerga os dois lados; a escrita enxerga um so.
--
--   Resultado: a batida cai no cadastro do VINCULO, a escala esta na OUTRA matricula, e
--   ninguem escreve nela. E a mesma forma de "a alocacao roda por dia e um dia nao sabe do
--   outro" (20260819180000), agora entre vinculos.
--
--   Caso real medido em 17/09/2026 (RAIDANES, mesmo CPF em duas matriculas): o vinculo
--   vigente no REP-iDClass-CCE-01 aponta para a mat 53729 (com biometria), a batida das 17:18
--   nasceu nela -- e a mat 53729 estava de FOLGA naquele dia. A escala era da mat 68152, cuja
--   linha ficou com a saida vazia. O relogio nao distingue as duas matriculas da mesma pessoa
--   (o AFD tipo 3 carrega NSR + data/hora + identificador + CRC, e nada mais), e o equipamento
--   recusa o 2o cadastro do mesmo PIS/CPF: e da norma, nao do iDClass.
--
-- 🚨 RECONCILIAR O IRMAO INTEIRO SERIA PIOR QUE O DEFEITO, E ISSO FOI MEDIDO
--   fn_reconciliar_marcacoes_dia escreve presenca_* = projecao SEM COALESCE. Estende-la ao
--   irmao significa reconciliar automaticamente dias que hoje nunca sao tocados.
--   Classificacao dos 425 pares (irmao, dia) candidatos de 09/2026, por
--   fn_conferir_reconciliacao (que nao escreve nada):
--
--       so acrescimo (preenche campo vazio) ......  10 pares, 14 horarios
--       TROCA de horario ja gravado .............   13 pares
--       PERDA (a projecao nao reproduz o atual) ..    4 pares
--       sem mudanca .............................  398 pares
--
--   As trocas nao sao ruido: ha deslocamento de 285 e 301 minutos em passos de intervalo, e
--   uma saida indo de 19:00 para 16:10. Por isso o irmao so recebe ACRESCIMO PURO -- o mesmo
--   criterio que fn_reconciliar_dia_pendente aplica desde 20260908110000: o sistema preenche o
--   que esta vazio e devolve a validacao manual o dia que ele mudaria.
--
-- ⚠️ O QUE **NAO** MUDA
--   * O servidor da batida continua sendo reconciliado exatamente como hoje, sem criterio novo.
--     Estreitar tambem o dono seria mudar o comportamento de toda ingestao para resolver um
--     caso de 76 CPFs.
--   * A resolucao de identidade nao e tocada. A batida e da PESSOA (decisao de 09/09/2026);
--     que ela nasca no cadastro do vinculo esta certo -- marcacoes_ponto.servidor_id e imutavel
--     e quem decide ONDE APLICAR e a escala.
--   * fn_reconciliar_dia_pendente (o botao da grade) NAO passa a alcancar irmao: ela e por
--     ESCALA e o coordenador abre a grade de cada matricula. Misturar as duas faria um clique
--     numa grade escrever noutra, sem previa.
--
-- ⚠️ DUPLA CONTAGEM ESTA PROTEGIDA POR CONSTRUCAO. O desempate por servidor_id da
--    20260909130000 garante que exatamente UM dos dois cadastros fica com a batida, e os dois
--    lados decidem o oposto -- entao reconciliar os dois em sequencia nao grava a mesma batida
--    duas vezes, em qualquer ordem.


-- ============================================================================
-- 1. A FONTE UNICA: reconciliar a PESSOA, nao so o cadastro
-- ============================================================================
-- 🚨 CAMINHO DE MAQUINA. Nao confere papel, escopo nem escala Fechada, exatamente como
--    fn_reconciliar_marcacoes_dia -- quem a chama e a ingestao do AFD. Por isso e GRANTada
--    so a service_role. Expor reconciliacao a usuario logado exige envelope proprio, e ele ja
--    existe: fn_reconciliar_dia_pendente (20260908110000).

CREATE OR REPLACE FUNCTION public.fn_reconciliar_pessoa_dia(
    p_servidor_id         uuid,
    p_data                date,
    p_limpar_sem_marcacao boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_proprio   jsonb;
    v_irmaos    jsonb := '[]'::jsonb;
    v_irmao     record;
    v_ganhos    integer;
    v_conflitos integer;
    v_r         jsonb;
    v_linhas    integer;
BEGIN
    -- 1) O dono da batida: comportamento INALTERADO.
    v_proprio := public.fn_reconciliar_marcacoes_dia(p_servidor_id, p_data, p_limpar_sem_marcacao);

    -- 2) Cada cadastro irmao (mesmo CPF, Ativo, nao mesclado) que tenha linha de escala no dia.
    FOR v_irmao IN
        SELECT i.irmao_id, i.irmao_matricula
          FROM public.fn_cadastros_irmaos(ARRAY[p_servidor_id]) i
         WHERE EXISTS (
             SELECT 1
               FROM public.escala_diaria ed
               JOIN public.escala_mensal em ON em.id = ed.escala_mensal_id
              WHERE em.servidor_id = i.irmao_id
                AND em.mes = extract(month from p_data)::integer
                AND em.ano = extract(year  from p_data)::integer
                AND ed.dia = extract(day from p_data)::integer
                AND ed.categoria <> 'Sobreaviso')
    LOOP
        BEGIN
            -- ACRESCIMO PURO: so grava se NENHUM campo ja preenchido mudaria de valor. Mesmo
            -- criterio de fn_reconciliar_dia_pendente. Um dia que deixou de ser acrescimo volta
            -- para a validacao manual -- listado, com o motivo, nunca escondido.
            WITH proj AS (
                SELECT * FROM public.fn_projecao_marcacoes_dia(v_irmao.irmao_id, p_data) WHERE confirmada
            ), cmp AS (
                SELECT v.atual, v.projetado
                  FROM proj p
                  JOIN public.escala_diaria ed ON ed.id = p.escala_diaria_id
                  CROSS JOIN LATERAL (VALUES
                      (ed.presenca_entrada_em,           p.entrada_em),
                      (ed.presenca_intervalo_saida_em,   p.int_saida_em),
                      (ed.presenca_intervalo_retorno_em, p.int_ret_em),
                      (ed.presenca_saida_em,             p.saida_em)
                  ) AS v(atual, projetado)
                 WHERE v.projetado IS DISTINCT FROM v.atual
            )
            SELECT count(*) FILTER (WHERE atual IS NULL),
                   count(*) FILTER (WHERE atual IS NOT NULL)
              INTO v_ganhos, v_conflitos
              FROM cmp;

            IF COALESCE(v_conflitos,0) > 0 THEN
                v_irmaos := v_irmaos || jsonb_build_object(
                    'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                    'status', 'conflito', 'campos', 0, 'conflitos', v_conflitos);
            ELSIF COALESCE(v_ganhos,0) = 0 THEN
                v_irmaos := v_irmaos || jsonb_build_object(
                    'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                    'status', 'sem_mudanca', 'campos', 0);
            ELSE
                -- p_limpar_sem_marcacao fica FALSE para o irmao SEMPRE, mesmo quando o chamador
                -- pediu true: a limpeza apaga presenca de dia sem marcacao, e aqui estamos num
                -- dia que nao e o do chamador. Ela so pode ser ligada apos o corte por
                -- unidades.fonte_ponto_oficial (Fase 5), e mesmo entao por decisao propria.
                v_r := public.fn_reconciliar_marcacoes_dia(v_irmao.irmao_id, p_data, false);

                -- Conta o que de fato ficou gravado, nunca o que se tentou (armadilha 22).
                SELECT count(*) INTO v_linhas
                  FROM public.fn_projecao_marcacoes_dia(v_irmao.irmao_id, p_data) p
                  JOIN public.escala_diaria ed ON ed.id = p.escala_diaria_id
                  CROSS JOIN LATERAL (VALUES
                      (ed.presenca_entrada_em,           p.entrada_em),
                      (ed.presenca_intervalo_saida_em,   p.int_saida_em),
                      (ed.presenca_intervalo_retorno_em, p.int_ret_em),
                      (ed.presenca_saida_em,             p.saida_em)
                  ) AS v(atual, projetado)
                 WHERE p.confirmada
                   AND v.projetado IS NOT NULL
                   AND v.atual IS NOT DISTINCT FROM v.projetado;

                v_irmaos := v_irmaos || jsonb_build_object(
                    'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                    'status', 'ok', 'campos', LEAST(COALESCE(v_ganhos,0), COALESCE(v_linhas,0)),
                    'esperados', COALESCE(v_ganhos,0), 'retorno', v_r);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Falha no irmao NUNCA derruba a reconciliacao do dono nem a ingestao do lote.
            -- O aviso deixa rastro: o efeito (a celula do irmao continuar vazia) e invisivel.
            RAISE WARNING 'Falha ao reconciliar cadastro irmao % em %: %', v_irmao.irmao_id, p_data, SQLERRM;
            v_irmaos := v_irmaos || jsonb_build_object(
                'servidor_id', v_irmao.irmao_id, 'matricula', v_irmao.irmao_matricula,
                'status', 'erro', 'campos', 0, 'erro', SQLERRM);
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'servidor_id', p_servidor_id, 'data', p_data,
        'proprio', v_proprio,
        'irmaos', v_irmaos);
END;
$fn$;

COMMENT ON FUNCTION public.fn_reconciliar_pessoa_dia(uuid, date, boolean) IS
    'Reconcilia o dia do servidor (comportamento inalterado) e, para cada cadastro IRMAO da '
    'mesma pessoa com escala naquele dia, aplica SO SE for acrescimo puro. Caminho de MAQUINA: '
    'nao confere papel nem escopo. O envelope de usuario e fn_reconciliar_dia_pendente.';

REVOKE ALL ON FUNCTION public.fn_reconciliar_pessoa_dia(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconciliar_pessoa_dia(uuid, date, boolean) TO service_role;


-- ============================================================================
-- 2. A INGESTAO DO AFD (copia mecanica; so a chamada mudou)
-- ============================================================================

`

const meio1 = `
REVOKE ALL ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ingerir_afd(uuid, uuid, jsonb, text, text, text, text, inet, uuid, boolean)
    TO service_role;


-- ============================================================================
-- 3. O REPARSE (copia mecanica; so a chamada mudou)
-- ============================================================================

`

const meio2 = `
REVOKE ALL ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reparse_afd_dispositivo(uuid, timestamptz) TO authenticated, service_role;


-- ============================================================================
-- 4. O TRIGGER DA FASE 5 (copia mecanica; so a chamada mudou)
-- ============================================================================
-- Inerte enquanto nenhuma unidade estiver em fonte_ponto_oficial = 'rep'. O trigger em si NAO
-- e recriado: a funcao e trocada por CREATE OR REPLACE e o trigger continua apontando para ela.

`

const conferencia = `
REVOKE ALL ON FUNCTION public.fn_reconciliar_apos_marcacao() FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- 5. CONFERENCIA -- EXECUTA as funcoes (armadilha 42)
-- ============================================================================
DO $conf$
DECLARE
    v_srv    uuid;
    v_r      jsonb;
    v_n      integer;
BEGIN
    -- 5.1 Uma unica assinatura de cada uma (sobrecarga = PGRST203)
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliar_pessoa_dia';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ABORTADO: ha % versao(oes) de fn_reconciliar_pessoa_dia (esperado 1).', v_n;
    END IF;

    -- 5.2 Privilegios: caminho de maquina. authenticated NAO pode executa-la -- ela escreve
    --     presenca sem conferir papel, escopo nem escala Fechada.
    IF has_function_privilege('anon', 'public.fn_reconciliar_pessoa_dia(uuid, date, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: anon executa fn_reconciliar_pessoa_dia.';
    END IF;
    IF has_function_privilege('authenticated', 'public.fn_reconciliar_pessoa_dia(uuid, date, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: authenticated executa fn_reconciliar_pessoa_dia -- ela nao confere papel nem escopo. O envelope de usuario e fn_reconciliar_dia_pendente.';
    END IF;
    IF NOT has_function_privilege('service_role', 'public.fn_reconciliar_pessoa_dia(uuid, date, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role PERDEU fn_reconciliar_pessoa_dia -- a ingestao do AFD para.';
    END IF;

    -- 5.3 EXECUTA. Uma data sem escala nenhuma nao escreve nada, mas percorre todo o caminho:
    --     a reconciliacao propria, a busca de irmaos e o laco.
    SELECT id INTO v_srv FROM public.servidores WHERE status = 'Ativo' LIMIT 1;
    IF v_srv IS NOT NULL THEN
        v_r := public.fn_reconciliar_pessoa_dia(v_srv, '1900-01-01'::date);
        IF v_r IS NULL OR v_r->'proprio' IS NULL OR jsonb_typeof(v_r->'irmaos') <> 'array' THEN
            RAISE EXCEPTION 'ABORTADO: fn_reconciliar_pessoa_dia devolveu %', v_r;
        END IF;
        RAISE NOTICE 'sonda: proprio=% irmaos=%', v_r->'proprio'->>'status', jsonb_array_length(v_r->'irmaos');
    END IF;

    -- 5.4 Os TRES chamadores de maquina passaram a apontar para a funcao nova, e NENHUM
    --     chamador de usuario foi arrastado junto: fn_reconciliar_dia_pendente continua
    --     chamando fn_reconciliar_marcacoes_dia direto (ela e por ESCALA, com previa na tela).
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_ingerir_afd','fn_reparse_afd_dispositivo','fn_reconciliar_apos_marcacao')
       AND p.prosrc LIKE '%fn_reconciliar_pessoa_dia%';
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'ABORTADO: % de 3 chamadores de maquina apontam para fn_reconciliar_pessoa_dia.', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_reconciliar_dia_pendente'
       AND p.prosrc LIKE '%fn_reconciliar_pessoa_dia%';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'ABORTADO: fn_reconciliar_dia_pendente passou a alcancar irmao. Ela e por ESCALA: um clique numa grade escreveria noutra, sem previa.';
    END IF;

    RAISE NOTICE 'reconciliacao alcanca o cadastro irmao: ok.';
END;
$conf$;
`

const saida = (cabecalho + fnIng + meio1 + fnRep + meio2 + fnTrg + conferencia).split('\n').join(EOL)
fs.writeFileSync(DESTINO, saida, 'utf8')

const res = saida.split(/\r?\n/).join('\n')
const invSaida = [
  ['tres chamadas a fn_reconciliar_pessoa_dia', /PERFORM public\.fn_reconciliar_pessoa_dia\(/g, 3],
  ['nenhuma chamada antiga sobrou nos tres', /PERFORM public\.fn_reconciliar_marcacoes_dia\(r\.servidor_id|PERFORM public\.fn_reconciliar_marcacoes_dia\(r_rec\.servidor_id/g, 0],
  ['a funcao nova chama a base duas vezes', /public\.fn_reconciliar_marcacoes_dia\(/g, 2],
  ['irmao nunca recebe p_limpar_sem_marcacao', /fn_reconciliar_marcacoes_dia\(v_irmao\.irmao_id, p_data, false\)/g, 1],
  ['ingestao mantem a idempotencia do lote', /IF FOUND AND v_existente\.status = 'concluida' THEN/g, 1],
  ['ingestao continua registrando marcacao orfa', /PERFORM public\.fn_registrar_marcacao\(/g, 1],
  ['trigger mantem o corte por fonte_ponto_oficial', /u\.fonte_ponto_oficial = 'rep'/g, 1],
  ['nenhum DROP com CASCADE', /DROP\s+FUNCTION[^;]*CASCADE/gi, 0],
  ['funcao nova fechada a authenticated', /REVOKE ALL ON FUNCTION public\.fn_reconciliar_pessoa_dia\(uuid, date, boolean\) FROM PUBLIC, anon, authenticated;/g, 1],
  ['conferencia EXECUTA a funcao nova', /v_r := public\.fn_reconciliar_pessoa_dia\(v_srv/g, 1],
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
