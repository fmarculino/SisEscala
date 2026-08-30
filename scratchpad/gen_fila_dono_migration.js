// Monta a migration do item 10 a partir dos blocos que gen_fila_dono.js gerou (copia mecanica
// das duas funcoes) mais o cabecalho, os GRANTs e a verificacao.
const fs = require('fs')

const blocos = fs.readFileSync('scratchpad/_fila_dono_blocos.sql', 'utf8')
const corpo = blocos.split(/\r?\n/)
  .filter(l => !l.startsWith('-- de supabase/migrations/'))
  .join('\n').trim()

if (!corpo.includes('fn_confirmar_cadastro_rep') || !corpo.includes('fn_confirmar_remocao_usuario_dispositivo')) {
  console.error('ABORTADO: os dois blocos precisam estar em _fila_dono_blocos.sql'); process.exit(1)
}

const CABECALHO = `-- ============================================================================
-- Fila do REP: o item confirmado tem que pertencer ao DISPOSITIVO autenticado
-- ============================================================================
-- 30/08/2026 - item 10 da auditoria de 30/08/2026.
--
-- O PROBLEMA
--   /api/rep/v1/pendencias e /api/rep/v1/remocoes autenticam o relogio por HMAC e ja tem o
--   \`dispositivoId\` em maos - mas NUNCA o usavam. O \`fila_id\` vinha do corpo da requisicao e era
--   repassado cru para a RPC, que tambem nao conferia nada: ela le o \`dispositivo_id\` DA LINHA da
--   fila e trabalha com ele.
--
--   Resultado: um relogio legitimo (ou alguem de posse do token de um relogio) confirmava item da
--   fila de OUTRO equipamento. No caminho do cadastro isso cria \`rep_vinculos_servidor\` no
--   dispositivo errado - e vinculo errado significa batida atribuida a quem nao bateu, meses
--   depois, sem nada no log. Silencioso dos dois lados.
--
--   Nao e alcancavel de fora: exige token de dispositivo valido. Por isso e media, nao critica.
--
-- ⚠️ POR QUE O PARAMETRO NOVO TEM DEFAULT NULL - e isso NAO e descuido
--   Sem default, a assinatura muda e a ordem migration/deploy passa a quebrar nos DOIS sentidos.
--   E medido que essa janela custa caro: quando a confirmacao de cadastro falha, o usuario JA FOI
--   CRIADO no relogio (ciclo.go:415 so registra um aviso), o item fica 'pendente', e no ciclo
--   seguinte o coletor tenta criar de novo -> o equipamento recusa por duplicidade
--   ('PIS ja cadastrado') -> fn_confirmar_cadastro_rep trata recusa como DEFINITIVA e o item vai
--   para 'falhou', exigindo reenfileiramento manual.
--
--   Com DEFAULT NULL, as duas ordens funcionam: o chamador antigo (que nao passa o parametro)
--   segue sem checagem, e o novo passa o dispositivo e a divergencia e RECUSADA.
--
--   ⚠️ O preco: a checagem so vale se quem chama PASSAR o parametro. Por isso existe o portao
--   scratchpad/sim_rep_fila_dono.js, que reprova rota de /api/rep/v1/ que consuma fila sem
--   repassar o dispositivo autenticado. Sem esse portao, a proxima rota esquece e ninguem ve.
--
-- COMO ESTE ARQUIVO FOI GERADO
--   scratchpad/gen_fila_dono.js - copia MECANICA das duas funcoes a partir do arquivo vigente
--   (armadilha 1), com o parametro e o guard inseridos por substituicao contada. O gerador ABORTA
--   se o corpo resultante divergir do original em qualquer coisa que nao seja o guard.
--     fn_confirmar_cadastro_rep                -> 20260817180000
--     fn_confirmar_remocao_usuario_dispositivo -> 20260812040000
--
-- 🚨 GRANTS NAO SAO HERDADOS. CREATE OR REPLACE com assinatura DIFERENTE cria um objeto NOVO, e
--   objeto novo nasce com EXECUTE para PUBLIC (armadilha 24). Os GRANT/REVOKE no fim deste arquivo
--   nao sao decorativos: sem eles, estas duas funcoes - que escrevem vinculo de servidor e apagam
--   cadastro de relogio - ficariam chamaveis por anon.
--
-- IDEMPOTENTE: DROP IF EXISTS da assinatura antiga + CREATE. Seguro rodar nos dois ambientes.
-- ============================================================================

-- A assinatura ANTIGA precisa sair: se as duas coexistirem, o PostgREST nao consegue escolher e
-- devolve PGRST203 ("could not choose the best candidate") - foi exatamente o que aconteceu com
-- fn_reparse_afd_dispositivo em 22/08/2026, quando uma sobrecarga antiga ficou viva.
DROP FUNCTION IF EXISTS public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean);
DROP FUNCTION IF EXISTS public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text);


`

const RODAPE = `

-- ============================================================================
-- PRIVILEGIOS - assinatura nova e objeto novo, entao os GRANTs sao reescritos
-- ============================================================================
REVOKE ALL ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text, uuid)
    TO service_role;


-- ============================================================================
-- VERIFICACAO - aborta se o resultado divergir
-- ============================================================================
DO $verifica$
DECLARE
    v_sobra   text;
    v_abertas text;
BEGIN
    -- 1) a assinatura ANTIGA nao pode ter sobrevivido (PGRST203)
    SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobra
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_confirmar_cadastro_rep', 'fn_confirmar_remocao_usuario_dispositivo')
       AND p.pronargs < CASE p.proname
                          WHEN 'fn_confirmar_cadastro_rep' THEN 7
                          ELSE 4
                        END;

    IF v_sobra IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: assinatura antiga sobreviveu (%). Com duas sobrecargas o PostgREST '
            'devolve PGRST203 e o coletor para de confirmar fila.', v_sobra;
    END IF;

    -- 2) as novas nao podem estar abertas a anon/PUBLIC (grants nao sao herdados)
    SELECT string_agg(DISTINCT p.proname, ', ') INTO v_abertas
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('fn_confirmar_cadastro_rep', 'fn_confirmar_remocao_usuario_dispositivo')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

    IF v_abertas IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORTADO: % executavel por anon/authenticated. Assinatura nova nasce aberta a '
            'PUBLIC (armadilha 24) - o REVOKE deste arquivo nao pegou.', v_abertas;
    END IF;

    -- 3) service_role PRECISA continuar executando: e o cliente que as rotas usam
    IF NOT has_function_privilege('service_role',
           'public.fn_confirmar_cadastro_rep(uuid, boolean, bigint, text, text, boolean, uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role',
           'public.fn_confirmar_remocao_usuario_dispositivo(uuid, boolean, text, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ABORTADO: service_role perdeu EXECUTE - o coletor para de confirmar fila.';
    END IF;

    RAISE NOTICE 'OK: fila do REP confere o dispositivo dono; assinatura antiga removida; grants reescritos.';
END
$verifica$;


-- ============================================================================
-- CONFERENCIA POR FORA (nao escreve) - rodar DEPOIS de aplicar
-- ============================================================================
--
-- 1) Existe UMA assinatura de cada (duas quebrariam o PostgREST):
--
--      SELECT oid::regprocedure FROM pg_proc
--       WHERE proname IN ('fn_confirmar_cadastro_rep','fn_confirmar_remocao_usuario_dispositivo');
--
-- 2) O guard recusa fila de outro dispositivo (usar dois dispositivos reais):
--
--      SELECT public.fn_confirmar_cadastro_rep('<fila_de_A>', true, NULL, NULL, NULL, false, '<id_de_B>');
--      -- esperado: ERRO 42501 'Item de fila ... nao pertence ao dispositivo autenticado.'
--
--      SELECT public.fn_confirmar_cadastro_rep('<fila_de_A>', true, NULL, NULL, NULL, false, '<id_de_A>');
--      -- esperado: sucesso
--
-- 3) O COLETOR continua funcionando (o que importa de verdade): numa unidade com relogio online,
--    enfileirar um cadastro em /marcacoes -> "Sincronizar cadastros" e conferir que o item sai de
--    'pendente' no ciclo seguinte (ate 5 min).
`

const saida = (CABECALHO + corpo + RODAPE).replace(/\r?\n/g, '\r\n')
const destino = 'supabase/migrations/20260830130000_fila_rep_confere_dispositivo.sql'
fs.writeFileSync(destino, saida, 'utf8')

// conferencias do arquivo montado
const c = (re) => (saida.match(re) || []).length
const checa = (ok, m) => { if (!ok) { console.error('ABORTADO: ' + m); process.exit(1) } }
checa(c(/CREATE OR REPLACE FUNCTION/g) === 2, 'esperava 2 CREATE OR REPLACE')
checa(c(/\$fn\$/g) === 4, 'delimitadores $fn$ desemparelhados')
checa(c(/\$verifica\$/g) === 2, 'delimitadores $verifica$ desemparelhados')
checa(c(/DROP FUNCTION IF EXISTS/g) === 2, 'esperava 2 DROP')
checa(c(/p_dispositivo_id uuid DEFAULT NULL/g) === 2, 'esperava 2 parametros novos')
checa(c(/RAISE EXCEPTION 'Item de fila/g) === 2, 'esperava 2 guards')
checa(c(/GRANT EXECUTE ON FUNCTION/g) === 2, 'esperava 2 GRANT')
checa(c(/REVOKE ALL ON FUNCTION/g) === 2, 'esperava 2 REVOKE')

console.log(`OK: ${destino}`)
console.log(`    ${saida.split('\r\n').length} linhas, CRLF, 8 conferencias estruturais passaram`)
